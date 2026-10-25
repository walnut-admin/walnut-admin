import type { IListRequestParams } from '@walnut-server/utils/listAggregate'
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import type { IWalnutAdminRequestList } from '../dto/list.dto'
import { isEmpty, isNaN, isNil, isObject } from 'lodash'

/**
 * PG 版列表构建器 —— 能力对应 Mongo 版 `@walnut-server/utils/listAggregate.ts`
 * （buildListPipelineFromRequest），载体从聚合管道换成 TypeORM QueryBuilder：
 *
 * - $match 语义对齐：字符串 → `ILIKE '%kw%'` 模糊（ILIKE 通配符 `%` `_` 与转义符
 *   显式转义 —— Mongo 版把用户输入当正则，PG 版收紧为字面量语义）、布尔/数值 → 等值、
 *   uuid 串 → 等值直传、日期数组 → `>= start AND < end`、普通数组 → IN、nil → 跳过；
 * - $sort / skip / limit 对齐：默认 `createdAt DESC`，order=false 的字段剔除，按
 *   priority 降序取优先级；
 * - $facet 等价物：`COUNT(*) OVER()` 窗口列，一趟查询同时取页内数据与过滤后总数
 *   （等价 `$facet: { data: [...], total: [...] }` 的单文档结果），不用双查询 ——
 *   同一快照内的 count 与 data 天然一致，还省一次往返。
 *
 * 出参与 Mongo 版消费端兼容：`{ data, total }`（对应 IWalnutAdminResponseList）。
 *
 * 与 Mongo 版的**已知差异**（消费方须知）：
 * - PG 强 schema：query / sort 里出现在实体列之外的键会被忽略（Mongo 对未知字段是
 *   「匹配不到任何行」）；入参白名单由 DTO 层 `onlyIn` 负责，这里只做防御性收敛。
 * - `extraPipeline`（$lookup 注入）没有管道等价物：需要 populate 的列表通过
 *   `customize` 钩子改写 QueryBuilder（加 JOIN / 子查询）。注意一旦发生 JOIN 放大，
 *   `COUNT(*) OVER()` 统计的是 join 后行数，与 Mongo $facet 的「文档数」语义可能分歧，
 *   届时应改用子查询或 EXISTS 承接 populate。
 */

// B2 起导出共用：locale.repo.service 的聚合重写（phase2 5.2）走同一套字面量转义口径
export const ILIKE_ESCAPE_REGEX = /[\\%_]/g

export interface IWalnutPgListQueryOptions {
  /** 列过滤：{ 属性名, 值 }；值形态决定谓词（见文件头注释） */
  match: Record<string, unknown>
  /** 排序：属性名 → ASC | DESC */
  sort: Record<string, 'ASC' | 'DESC'>
  skip: number
  limit: number
}

/** COUNT(*) OVER() 窗口列的 raw 别名（够独特，避免与实体列 raw 别名撞名） */
export const WALNUT_PG_LIST_TOTAL_ALIAS = 'walnut_row_total'

function isUuidString(value: unknown): boolean {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/**
 * 请求参数 → 归一化的 match / sort / skip / limit。纯数据变换，与 Mongo 版
 * buildListQuery 逐分支对齐（数值等值是 PG 版补充 —— Mongo 版对数值是静默丢弃）。
 */
export function buildPgListQueryOptions<T>(
  params: Partial<IListRequestParams<T>> | IWalnutAdminRequestList<T> = {},
  extraMatch: Record<string, unknown> = {},
): IWalnutPgListQueryOptions {
  const defaults: IWalnutPgListQueryOptions = {
    match: { ...extraMatch },
    sort: { createdAt: 'DESC' },
    skip: 0,
    limit: 10,
  }

  if (isEmpty(params) || Object.keys(params).length === 0) {
    return defaults
  }

  const { query, sort, page = { page: 1, pageSize: 10 } } = params

  const match: Record<string, unknown> = { ...extraMatch }

  if (isObject(query) && Object.keys(query).length > 0) {
    Object.entries(query).forEach(([key, value]) => {
      if (isNil(value))
        return

      if (typeof value === 'string' && !isUuidString(value)) {
        match[key] = { op: 'ilike', value }
        return
      }

      if (typeof value === 'boolean' || typeof value === 'number' || isUuidString(value)) {
        match[key] = { op: 'eq', value }
        return
      }

      if (Array.isArray(value) && value.length > 0) {
        const isDateRange = value.every((v: string) => !isNaN(new Date(v).getTime()))

        if (isDateRange) {
          match[key] = { op: 'range', value: [new Date(value[0] as string), new Date(value[1] as string)] }
        }
        else {
          match[key] = { op: 'in', value }
        }
      }
    })
  }

  let sortOptions: Record<string, 'ASC' | 'DESC'> = defaults.sort
  if (Array.isArray(sort) && sort.length > 0) {
    const sortEntries = sort
      .filter(s => s.order !== false)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .map(s => [s.field, s.order === 'ascend' ? 'ASC' : 'DESC'] as [string, 'ASC' | 'DESC'])

    if (sortEntries.length > 0) {
      sortOptions = Object.fromEntries(sortEntries)
    }
  }

  const skip = (Number(page.page) - 1) * Number(page.pageSize)
  const limit = Number(page.pageSize)

  return { match, sort: sortOptions, skip, limit }
}

/**
 * 把归一化选项落到 QueryBuilder 上。只收实体已声明的列（防御性收敛，见文件头
 * 「已知差异」）；所有值一律参数化，字符串模糊仅对 ILIKE 通配符做字面量转义。
 */
export function applyPgListQuery<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  options: IWalnutPgListQueryOptions,
): SelectQueryBuilder<T> {
  const columns = new Set((qb.expressionMap.mainAlias?.metadata?.columns ?? []).map(c => c.propertyName))

  let paramSeq = 0
  const nextParam = (key: string) => `${alias}_${key}_${paramSeq++}`

  Object.entries(options.match).forEach(([key, condition]) => {
    if (!columns.has(key) || isNil(condition) || typeof condition !== 'object')
      return

    const { op, value } = condition as { op: string, value: unknown }

    if (op === 'ilike') {
      const param = nextParam(key)
      const escaped = String(value).replace(ILIKE_ESCAPE_REGEX, c => `\\${c}`)
      qb.andWhere(`${alias}.${key} ILIKE :${param}`, { [param]: `%${escaped}%` })
      return
    }

    if (op === 'eq') {
      const param = nextParam(key)
      qb.andWhere(`${alias}.${key} = :${param}`, { [param]: value })
      return
    }

    if (op === 'in') {
      const param = nextParam(key)
      qb.andWhere(`${alias}.${key} IN (:...${param})`, { [param]: value })
      return
    }

    if (op === 'range') {
      const [start, end] = value as [Date, Date]
      const startParam = nextParam(key)
      const endParam = nextParam(key)
      qb.andWhere(`${alias}.${key} >= :${startParam}`, { [startParam]: start })
      qb.andWhere(`${alias}.${key} < :${endParam}`, { [endParam]: end })
    }
  })

  Object.entries(options.sort).forEach(([key, direction]) => {
    if (columns.has(key)) {
      qb.addOrderBy(`${alias}.${key}`, direction)
    }
  })

  qb.offset(options.skip).limit(options.limit)

  return qb
}

/**
 * 执行已构建的列表查询：单趟 SELECT 借 `COUNT(*) OVER()` 同时带出过滤后总数，
 * 返回与 Mongo 版消费端兼容的 `{ data, total }`。
 */
export async function executePgListQuery<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>): Promise<{ data: T[], total: number }> {
  qb.addSelect(`COUNT(*) OVER()`, WALNUT_PG_LIST_TOTAL_ALIAS)

  const { entities, raw } = await qb.getRawAndEntities()

  const firstRaw = raw[0] as Record<string, unknown> | undefined
  const total = Number(firstRaw?.[WALNUT_PG_LIST_TOTAL_ALIAS] ?? 0)

  return { data: entities, total }
}

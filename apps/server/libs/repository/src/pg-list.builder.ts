import type { IWalnutAdminRequestList } from '@walnut-server/list'
import type { EntityMetadata, ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import type { IWalnutPgListCondition, WalnutPgColumnKind } from './pg-column-op'
import { normalizeListPage } from '@walnut-server/utils/list-page'
import { isNil, isObject } from 'lodash'
import {
  createPgColumnKindResolver,
  defaultPgListSort,
  escapeLikePattern,
  isPgListOpAllowed,
  isPgSortableColumnKind,
  normalizeSortOrder,
  resolvePgListCondition,
  warnDroppedPgListCondition,
} from './pg-column-op'

/**
 * PG 版列表构建器 —— 能力对应 Mongo 版 `@walnut-server/utils/listAggregate.ts`
 * （buildListPipelineFromRequest），载体从聚合管道换成 TypeORM QueryBuilder。
 *
 * ## 算子决策的单一真源是 `pg-column-op.ts`（批次 1 · P0 止血）
 *
 * 迁移初期这里按 **JS 值的 typeof** 挑算子（字符串 → ILIKE / 布尔·数值·uuid 串 → 等值 /
 * 日期数组 → 区间 / 普通数组 → IN）。Mongo 无 schema 时成立，PG 有列类型时**必然炸**：
 * R1 实测 6 列类型 × 5 入参形态的 30 格里 22 格产生 PG 错误（42883 / 22P02 / 22007 / 22008）。
 * 现在算子由**列类型**决定、值按列类型的输入语法解释，解释不了就**丢弃该条件 + warn**
 * （Lead 拍板 Q1：不做 400，先把 500 变不见）。
 *
 * ## 出参与 Mongo 版消费端兼容
 *
 * `{ data, total }`（对应 IWalnutAdminResponseList）；total 用 `COUNT(*) OVER()` 窗口列，
 * 一趟查询同时取页内数据与过滤后总数（等价 `$facet`）。
 *
 * ## 与 Mongo 版的**已知差异**（消费方须知）
 *
 * - PG 强 schema：query / sort 里出现在实体列之外的键会被忽略（Mongo 对未知字段是
 *   「匹配不到任何行」）；入参白名单由 DTO 层 `onlyIn` 负责，这里只做防御性收敛。
 * - `extraPipeline`（$lookup 注入）没有管道等价物：需要 populate 的列表通过
 *   `customize` 钩子改写 QueryBuilder（加 JOIN / 子查询）。注意一旦发生 JOIN 放大，
 *   `COUNT(*) OVER()` 统计的是 join 后行数，与 Mongo $facet 的「文档数」语义可能分歧 ——
 *   已知风险，见 reports/batch-1/r1-be-verification.md §9 坑 5（P2，本批不做）。
 */

/** 兼容旧 import 面：转义口径已迁 `pg-column-op`，此处 re-export */
export { escapeLikePattern, ILIKE_ESCAPE_REGEX } from './pg-column-op'

/**
 * Server-side list request params.
 * Shape mirrors @walnut/contract BaseListParams but uses Partial<T> for query
 * (backend accepts subset fields) and is compatible with runtime DTO factories.
 * Cannot be a direct type alias due to class-transformer DTO structural differences.
 */
export interface IListRequestParams<T> {
  query?: Partial<T>
  sort?: Array<{ field: string, order: 'ascend' | 'descend' | false, priority?: number }>
  page?: { page: number, pageSize: number }
}

export interface IWalnutPgListQueryOptions {
  /** 列过滤：{ 属性名, 条件 }；条件由**列类型**解释（见 pg-column-op） */
  match: Record<string, IWalnutPgListCondition>
  /** 排序：属性名 → ASC | DESC */
  sort: Record<string, 'ASC' | 'DESC'>
  skip: number
  limit: number
  /** 实体元数据快照：SQL 层据此二次裁决（值 → 条件的权威口径） */
  metadata?: EntityMetadata
  /** page 入参是否被正规化过（供调用方记日志） */
  pageAdjusted?: boolean
}

/** COUNT(*) OVER() 窗口列的 raw 别名（够独特，避免与实体列 raw 别名撞名） */
export const WALNUT_PG_LIST_TOTAL_ALIAS = 'walnut_row_total'

/**
 * 请求参数 → 归一化的 match / sort / skip / limit。
 *
 * `resolveKind` 缺省时退回**旧的 typeof 推断**（仅为兼容潜在的库外调用方）；
 * 库内所有消费者都经 `buildPgListQueryOptionsFromQb` 或显式传 resolver，
 * 且 `applyPgListQuery` 会用 `condition.raw` 再裁决一次 —— 两条腿都不依赖 typeof。
 */
export function buildPgListQueryOptions<T>(
  params: Partial<IListRequestParams<T>> | IWalnutAdminRequestList<T> = {},
  extraMatch: Record<string, unknown> = {},
  resolveKind?: (property: string) => WalnutPgColumnKind | undefined,
  metadata?: EntityMetadata,
): IWalnutPgListQueryOptions {
  const defaultSort = defaultPgListSort(metadata)

  const { query, sort, page } = params as Partial<IListRequestParams<T>>

  const normalized = normalizeListPage(page)

  const match: Record<string, IWalnutPgListCondition> = {}

  // extraMatch 由调用方给定（服务端硬条件），原样下发，不经值解释
  Object.entries(extraMatch).forEach(([key, value]) => {
    if (!isNil(value)) {
      match[key] = { op: 'eq', value }
    }
  })

  if (isObject(query) && Object.keys(query).length > 0) {
    Object.entries(query as Record<string, unknown>).forEach(([key, value]) => {
      if (isNil(value)) {
        return
      }

      if (resolveKind === undefined) {
        // 兼容路径：旧 typeof 推断，但把 raw 带上 —— SQL 层会按列类型重裁决
        const legacy = legacyConditionFromValue(value)
        if (legacy !== undefined) {
          match[key] = { ...legacy, raw: value }
        }
        return
      }

      const kind = resolveKind(key)

      if (kind === undefined) {
        // 不是实体列（或类型不认识）：与既有 `columns.has()` 白名单同语义，静默丢弃
        return
      }

      const condition = resolvePgListCondition(kind, value)

      if (condition === undefined) {
        warnDroppedPgListCondition(key, kind, value, '值无法按列类型解释')
        return
      }

      match[key] = condition
    })
  }

  // ---- sort：白名单收敛 + 方向归一 + 未知字段**不得清空默认排序** ----
  const sortEntries = Array.isArray(sort)
    ? sort
        .map((item) => {
          if (item === undefined || item === null || typeof item.field !== 'string') {
            return undefined
          }

          const direction = normalizeSortOrder(item.order)

          // false = 该列不排序（contract 的 SortOrder 允许）；非法方向同样丢弃
          if (direction === undefined || direction === false) {
            return undefined
          }

          // 非实体列 / 原生数组列：丢弃该排序项，但**保留** defaultSort
          if (resolveKind !== undefined && !isPgSortableColumnKind(resolveKind(item.field))) {
            return undefined
          }

          return { field: item.field, direction, priority: item.priority ?? 0 }
        })
        .filter((item): item is { field: string, direction: 'ASC' | 'DESC', priority: number } => item !== undefined)
        .sort((a, b) => b.priority - a.priority)
    : []

  const sortOptions: Record<string, 'ASC' | 'DESC'> = sortEntries.length > 0
    ? Object.fromEntries(sortEntries.map(item => [item.field, item.direction]))
    : defaultSort

  return { match, sort: sortOptions, skip: normalized.skip, limit: normalized.limit, metadata, pageAdjusted: normalized.adjusted }
}

/**
 * 带实体上下文的入口 —— 库内所有 list 调用点的**标准写法**。
 *
 * qb 一定先于 build 创建（`applyPgListQuery` 需要它），所以从 qb 的 metadata 取列类型，
 * 免去调用方自己找 EntityMetadata。
 */
export interface IWalnutPgListQueryContext {
  expressionMap: {
    mainAlias?: { metadata?: EntityMetadata }
    /** 已落下的 ORDER BY（applyPgListQuery 用它在收尾时判断是否需要兜底排序） */
    orderBys?: Record<string, unknown>
  }
}

export function buildPgListQueryOptionsFromQb<T>(
  qb: IWalnutPgListQueryContext,
  params: Partial<IListRequestParams<T>> | IWalnutAdminRequestList<T> = {},
  extraMatch: Record<string, unknown> = {},
): IWalnutPgListQueryOptions {
  const metadata = qb.expressionMap.mainAlias?.metadata

  return buildPgListQueryOptions<T>(params, extraMatch, createPgColumnKindResolver(metadata), metadata)
}

/**
 * 把归一化选项落到 QueryBuilder 上。
 *
 * **权威裁决点**：即便 `match` 是别处（旧 typeof 路径 / 手写构造）塞进来的，
 * 这里也会用列元数据 + `condition.raw` 重新裁决一遍 —— 类型不匹配的条件一律不生成 SQL。
 * 所有值一律参数化，字符串模糊仅对 ILIKE 通配符做字面量转义。
 */
export function applyPgListQuery<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  options: IWalnutPgListQueryOptions,
): SelectQueryBuilder<T> {
  const metadata = options.metadata ?? qb.expressionMap.mainAlias?.metadata
  const resolveKind = createPgColumnKindResolver(metadata)

  let paramSeq = 0
  const nextParam = (key: string) => `${alias}_${key}_${paramSeq++}`

  Object.entries(options.match).forEach(([key, condition]) => {
    if (isNil(condition) || typeof condition !== 'object') {
      return
    }

    const kind = resolveKind(key)

    if (kind === undefined) {
      // 非实体列：静默丢弃（与历史 `columns.has()` 白名单一致）
      return
    }

    // 权威路径：有 raw 就按列类型重新解释；解释不了 → 丢弃 + warn
    const resolved = condition.raw === undefined
      ? (isPgListOpAllowed(condition.op, kind) ? condition : undefined)
      : resolvePgListCondition(kind, condition.raw)

    if (resolved === undefined || !isPgListOpAllowed(resolved.op, kind)) {
      warnDroppedPgListCondition(key, kind, condition.raw ?? condition.value, 'SQL 层裁决拒绝该算子/值')
      return
    }

    if (resolved.op === 'ilike') {
      const param = nextParam(key)
      qb.andWhere(`${alias}.${key} ILIKE :${param}`, { [param]: `%${escapeLikePattern(String(resolved.value))}%` })
      return
    }

    if (resolved.op === 'eq') {
      const param = nextParam(key)
      qb.andWhere(`${alias}.${key} = :${param}`, { [param]: resolved.value })
      return
    }

    if (resolved.op === 'in') {
      const param = nextParam(key)
      qb.andWhere(`${alias}.${key} IN (:...${param})`, { [param]: resolved.value })
      return
    }

    if (resolved.op === 'range') {
      const [start, end] = resolved.value as [Date, Date]
      const startParam = nextParam(key)
      const endParam = nextParam(key)
      qb.andWhere(`${alias}.${key} >= :${startParam}`, { [startParam]: start })
      qb.andWhere(`${alias}.${key} < :${endParam}`, { [endParam]: end })
    }
  })

  Object.entries(options.sort).forEach(([key, direction]) => {
    if (isPgSortableColumnKind(resolveKind(key))) {
      qb.addOrderBy(`${alias}.${key}`, direction)
    }
  })

  // 兜底：一个可排序字段都没落下 ⇒ 用实体缺省排序（否则 LIMIT/OFFSET 翻页会重复/丢行）
  if (Object.keys(qb.expressionMap.orderBys ?? {}).length === 0) {
    Object.entries(defaultPgListSort(metadata)).forEach(([key, direction]) => {
      if (isPgSortableColumnKind(resolveKind(key))) {
        qb.addOrderBy(`${alias}.${key}`, direction)
      }
    })
  }

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

/** 兼容路径专用：旧的 typeof 推断（仅当调用方没给列类型解析器时使用；SQL 层仍会重裁决） */
function legacyConditionFromValue(value: unknown): Omit<IWalnutPgListCondition, 'raw'> | undefined {
  if (typeof value === 'string') {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      ? { op: 'eq', value }
      : { op: 'ilike', value }
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return { op: 'eq', value }
  }

  if (Array.isArray(value) && value.length > 0) {
    const isDateRange = value.every((v: unknown) => !Number.isNaN(new Date(v as string).getTime()))
    return isDateRange
      ? { op: 'range', value: [new Date(value[0] as string), new Date(value[1] as string)] }
      : { op: 'in', value }
  }

  return undefined
}

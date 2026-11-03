import type { IWalnutAdminListFilters, IWalnutAdminRequestList } from '@walnut-server/list'
import type { EntityMetadata, ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import type { IWalnutPgListCondition, WalnutPgColumnKind } from './pg-column-op'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { normalizeListPage } from '@walnut-server/utils/list-page'
import { isNil, isObject } from 'lodash'
import {
  createPgColumnKindResolver,
  defaultPgListSort,
  escapeLikePattern,
  isPgListOpAllowed,
  isPgSortableColumnKind,
  isWalnutPgFilterOp,
  normalizeSortOrder,
  resolvePgFilterCondition,
  resolvePgListCondition,
  toPgListConditionOp,
  warnDroppedPgListCondition,
  withPgListTiebreaker,
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
 * 服务端范围的 list 入参。
 *
 * 形状对齐 `@walnut/contract` 的 BaseListParams（批次 4-A 起是 filters，不再是 query），
 * 但这里把过滤项放宽成库内类型（`IWalnutAdminListFilters`），以便兼容
 * class-transformer 生成的 DTO 实例（结构型，不能直接 type alias）。
 */
export interface IListRequestParams<T> {
  /** 显式过滤条件（批次 4-A 主路径）：算子由调用方给，非法 op/值 => 40099 */
  filters?: IWalnutAdminListFilters
  /**
   * @deprecated 旧 wire（`query: Partial<Entity>`，算子按值的 typeof 猜）——
   * **过渡态，按下面的判据删除，不要再往里加东西**。
   *
   * 批次 4-A 起 HTTP 层已不接受该槽位（DTO 里没有 query 字段，顶层白名单直接 40099），
   * 所以它今天唯一的用途是「库内/库外直接构造 `IListRequestParams` 的兜底」：
   * 语义是**丢弃 + warn**，与 filters 的严格模式互补。
   *
   * ## 删除判据（批次 9 · C7；两条全满足才删，缺一条就继续留着）
   *
   * 1. **静态 0 调用点**：`git grep -n "query:" -- apps/server/libs apps/server/apps` 里
   *    构造该槽位的地方为 **0**（今天只有本文件与 `*.spec.ts` 命中；spec 随删除一起删）。
   * 2. **运行面连续 30 天无触达**（= 一个完整发版周期，与设备 cookie 的双读窗口同量级）：
   *    生产日志里 0 条来自本路径的 `丢弃 list 过滤条件`（`warnDroppedPgListCondition` 的
   *    debug 明细 / 每 100 次那条 warn 汇总）。**注意：这条路径解释成功时是完全静默的**，
   *    所以「没看到 warn」不等于「没被走到」—— 真要按第 2 条判，先给它补一条触达计数
   *    （与丢弃同一套「每 N 次落 1 条汇总」机制），否则只能按第 1 条 + 「一个发版周期」判。
   *
   * 删除时**四处一起**（漏一处就是半删：留着的 `raw` 分支会把条件当「手写构造」处理）：
   * ① 本字段；② `buildPgListQueryOptions` 里那条 `// ---- query：...` 分支；
   * ③ `legacyConditionFromValue()`；④ `applyPgListQuery` 里 `condition.raw` 的两个分支，
   *    以及 `IWalnutPgListCondition.raw` 字段本身（`pg-column-op.ts`）。
   * 删完 `resolvePgListCondition` 只剩「手写构造」的调用面，届时再决定它是否也退场。
   */
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
  const defaultSort = withPgListTiebreaker(defaultPgListSort(metadata), metadata)

  const { filters, query, sort, page } = params as Partial<IListRequestParams<T>>

  const normalized = normalizeListPage(page)

  const match: Record<string, IWalnutPgListCondition> = {}

  // extraMatch 由调用方给定（服务端硬条件），原样下发，不经值解释
  Object.entries(extraMatch).forEach(([key, value]) => {
    if (!isNil(value)) {
      match[key] = { op: 'eq', value }
    }
  })

  // ---- filters：显式 op 主路径（批次 4-A）·裁决不过就是 40099，不再丢弃 ----
  const rejections: string[] = []

  if (Array.isArray(filters) && filters.length > 0) {
    filters.forEach((filter) => {
      if (!isObject(filter) || typeof filter.field !== 'string' || filter.field === '') {
        return
      }

      const key = filter.field
      const wireOp = (filter as { op?: unknown }).op

      if (!isWalnutPgFilterOp(wireOp)) {
        rejections.push(
          `filters[${key}]: 未知算子 ${String(wireOp)
          }（只允许 eq / like / in / range / isNull）`,
        )
        return
      }

      if (resolveKind === undefined) {
        // 没有列类型权威（库外直接调用）：原样透传，由 applyPgListQuery 用实体元数据裁决
        match[key] = { op: toPgListConditionOp(wireOp), value: filter.value, filterOp: wireOp }
        return
      }

      const kind = resolveKind(key)

      if (kind === undefined) {
        // 不是实体列：filters 面本来就含 JOIN 别名 / jsonb 旁路键，按既有 columns.has() 语义丢弃
        return
      }

      const verdict = resolvePgFilterCondition(kind, wireOp, filter.value)

      if (!verdict.ok) {
        rejections.push(`filters[${key}].${wireOp}: ${verdict.reason}`)
        return
      }

      match[key] = verdict.condition
    })

    if (rejections.length > 0) {
      throw new WalnutAdminExceptionRequestDataError(`非法 list 过滤条件 —— ${rejections.join('; ')}`)
    }
  }

  // ---- query：旧 wire 兼容路径（算子按 typeof 猜，猜不出来丢弃 + warn）----
  // 过渡态：删除判据写在 IListRequestParams.query 的 TSDoc 里（批次 9 · C7），别在这里加新逻辑。
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

  // D15 稳定性兜底：任何排序都追加主键作最后一个键（否则同毫秒行在 LIMIT/OFFSET 下漏行/重行）
  const sortOptions: Record<string, 'ASC' | 'DESC'> = sortEntries.length > 0
    ? withPgListTiebreaker(Object.fromEntries(sortEntries.map(item => [item.field, item.direction])), metadata)
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

    // 三条路径，权威都在这里（列元数据）：
    // 1. 显式 filters（condition.filterOp）：按 (op, 列类型) 重裁决，不过就 **40099**；
    // 2. 旧 wire 兼容（condition.raw）：按值的 typeof 重解释，解释不了丢弃 + warn；
    //    过渡态，删除判据见 IListRequestParams.query 的 TSDoc（批次 9 · C7）；
    // 3. 手写构造（service 内部硬条件）：算子白名单兜底，不过丢弃 + warn。
    let resolved: IWalnutPgListCondition | undefined

    if (condition.filterOp !== undefined) {
      const verdict = resolvePgFilterCondition(kind, condition.filterOp, condition.value)

      if (!verdict.ok) {
        throw new WalnutAdminExceptionRequestDataError(
          `非法 list 过滤条件 —— filters[${key}].${condition.filterOp}: ${verdict.reason}`,
        )
      }

      resolved = verdict.condition
    }
    else if (condition.raw === undefined) {
      resolved = isPgListOpAllowed(condition.op, kind) ? condition : undefined
    }
    else {
      resolved = resolvePgListCondition(kind, condition.raw)

      if (resolved !== undefined && !isPgListOpAllowed(resolved.op, kind)) {
        resolved = undefined
      }
    }

    if (resolved === undefined) {
      warnDroppedPgListCondition(key, kind, condition.raw ?? condition.value, 'SQL 层裁决拒绝该算子/值')
      return
    }

    if (resolved.op === 'isNull') {
      qb.andWhere(`${alias}.${key} IS ${resolved.value === true ? 'NULL' : 'NOT NULL'}`)
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

  // 排序两步定稿（顺序即落 SQL 顺序）：
  // 1. 先按列白名单收敛 options.sort —— 不可排序列（未知列 / 原生数组列）丢弃；
  // 2. 再追加主键兜底（D15）—— 一个可排序列都没剩时改用实体缺省排序，同样追加主键。
  // 这样既保住「未知 field 不清空默认排序」的既有语义，也保证任何查询都有全序。
  const sortable: Record<string, 'ASC' | 'DESC'> = {}

  Object.entries(options.sort).forEach(([key, direction]) => {
    if (isPgSortableColumnKind(resolveKind(key))) {
      sortable[key] = direction
    }
  })

  const finalSort = Object.keys(sortable).length > 0
    ? withPgListTiebreaker(sortable, metadata)
    : withPgListTiebreaker(defaultPgListSort(metadata), metadata)

  Object.entries(finalSort).forEach(([key, direction]) => {
    if (isPgSortableColumnKind(resolveKind(key))) {
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

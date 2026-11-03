/**
 * Shared pagination / list-request contract between frontend and backend.
 * Frontend: shipped via @walnut/http
 * Backend: used as base shapes by DTO factories
 *
 * ## 批次 4-A：`query` 已被 `filters` 取代（破坏性变更，用户已批准）
 *
 * 旧形态是 `query?: T`（T = ORM 实体 DTO 的 partial 派生）—— 它把**后端实体的形状**
 * 抬进了前后端共享契约，且算子是后端按 `typeof value` 猜出来的。PG 有列类型，
 * 「值的 JS 类型 ≠ 列类型」会在数据库侧炸（R1 实测 30 格 22 格报错，见
 * reports/batch-1/r1-be-verification.md）。
 *
 * 现在过滤条件显式写成 `{ field, op, value }`：
 * - `op` 由调用方给定，**不再由 JS 值推断**；
 * - 该 `op` 对某个列类型是否可用，由后端按列类型裁决（见 server 的 pg-column-op）；
 * - `field` 是普通字符串 —— 契约不再承载任何实体形状。
 */

/** Sort direction for list queries */
export type SortOrder = 'ascend' | 'descend' | false

/** Runtime constant for SortOrder values (for decorators / Swagger enum generation) */
export const SortOrderValues = {
  ASCEND: 'ascend',
  DESCEND: 'descend',
} as const

/**
 * Filter operators for list queries.
 *
 * 白名单是**跨端口径**（前后端同一份），但某个算子对某列是否可用只能在服务端裁决：
 * `like` 只对文本列可用，`range` 只对时间列可用，`isNull` 对所有列可用。
 */
export const FilterOpValues = {
  EQ: 'eq',
  LIKE: 'like',
  IN: 'in',
  RANGE: 'range',
  IS_NULL: 'isNull',
} as const

/** Filter operator union */
export type FilterOp = typeof FilterOpValues[keyof typeof FilterOpValues]

/**
 * Single filter parameter.
 *
 * `value` 的形态由 `op` 决定（`eq` 标量 / `like` 字符串 / `in` 数组 /
 * `range` 长度 2 的数组 / `isNull` 不带值）。
 */
export interface FilterParam {
  field: string
  op: FilterOp
  value?: unknown
}

/** Array of filter parameters (all of them are AND-ed) */
export type BaseFilterParams = FilterParam[]

/** Single sort parameter */
export interface SortParam<T = any> {
  field: keyof T
  order: SortOrder
  priority: number
}

/** Array of sort parameters (ordered by priority) */
export type BaseSortParams<T = any> = SortParam<T>[]

/** Pagination request parameters */
export interface BasePageParams {
  page: number
  pageSize: number
}

/** Standard list request shape */
export interface BaseListParams<T = any> {
  filters?: BaseFilterParams
  sort?: BaseSortParams<T>
  page?: BasePageParams
}

/** Standard list response shape */
export interface BaseListResponse<T = any> {
  data: T[]
  total: number
}

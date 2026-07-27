/**
 * Shared pagination contract between frontend and backend.
 * Frontend: shipped via @walnut/axios
 * Backend: used as base shapes by DTO factories
 */

/** Sort direction for list queries */
export type SortOrder = 'ascend' | 'descend' | false

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
  query?: T
  sort?: BaseSortParams<T>
  page?: BasePageParams
}

/** Standard list response shape */
export interface BaseListResponse<T = any> {
  data: T[]
  total: number
}

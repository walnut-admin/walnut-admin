import type { BaseFilterParams, BaseListParams, BasePageParams, BaseSortParams, FilterParam } from '@walnut/contract'

/**
 * 表格 / 选择器的 **query 表单值 → list 请求的显式 filters**（批次 4-A）。
 *
 * ## 为什么需要这一层
 *
 * 后端在批次 4-A 把 list 入参从 `query: Partial<Entity>`（算子按值的 JS 类型猜）换成了
 * `filters: [{ field, op, value }]`（算子显式、非法 op/值直接 40099，不再静默丢弃）。
 * 前端这边的 query 表单仍然是**一堆界面值**（输入框字符串 / 开关布尔 / 日期区间数组 /
 * 下拉选中的 uuid），所以必须有一处把它们翻译成显式算子 —— 就是本文件。
 *
 * ## 形态 → 算子（唯一口径）
 *
 * | 值形态 | op | 说明 |
 * |--------|----|------|
 * | undefined / null / '' / 空数组 | （不产生） | 空值不下发条件，与旧版「空串不过滤」一致 |
 * | 长度 2 且两端都是可解析时间（Date / ISO 串） | `range` | 只有**时间列**接受；日期区间控件都出这个形态 |
 * | 其余数组 | `in` | 多选（字典 / 枚举） |
 * | uuid 形态字符串 | `eq` | uuid 列只吃等值（`like` 会被后端拒成 40099） |
 * | 其余字符串 | `like` | 子串模糊（后端 ILIKE，`%` `_` 由后端转义） |
 * | number / boolean | `eq` | |
 * | 其它对象 | （不产生） | 表单不应产生对象值；出现了也不猜语义 |
 *
 * 这套映射等价于**旧后端按 `typeof value` 的推断**（R1 实测的那套），只是现在由前端
 * 显式写进 wire —— 后端不再猜，猜错的组合会变成 40099 而不是 50000。
 *
 * ## 前端不猜列类型（一处例外由后端补）
 *
 * 这里只看得见「值形态」，看不见「字段是什么列」—— 因此布尔列的字典值（`sys_shared_status`
 * 的 `'true'` / `'false'`，见 `apps/server/db/seed/sys_dict_data.json`）下发时**必然**是
 * `op: 'like'`。后端在列类型裁决点把这颗字典值翻成真布尔并按等值执行（`pg-column-op.ts` 的
 * `resolvePgFilterCondition`，批次 9 · C6）—— 所以**不要**在前端加「字段 → 列类型」的镜像表，
 * 那是第二个真源，列类型的权威在后端实体元数据里。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return true
  }
  return Array.isArray(value) && value.length === 0
}

/** 值能否按「时间」解释（Date 或可解析字符串；数字刻意不收 —— `new Date(1)` 会造出 1970 区间） */
function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }
  return undefined
}

function isDateRange(value: readonly unknown[]): boolean {
  return value.length === 2 && toDate(value[0]) !== undefined && toDate(value[1]) !== undefined
}

/** 单个字段值 → 过滤项（空值返回 undefined，表示不下发） */
export function buildWalnutListFilter(field: string, value: unknown): FilterParam | undefined {
  if (isEmptyValue(value)) {
    return undefined
  }

  if (Array.isArray(value)) {
    return isDateRange(value)
      ? { field, op: 'range', value: [toDate(value[0])!.toISOString(), toDate(value[1])!.toISOString()] }
      : { field, op: 'in', value }
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return { field, op: 'eq', value }
  }

  if (typeof value === 'string') {
    return UUID_RE.test(value) ? { field, op: 'eq', value } : { field, op: 'like', value }
  }

  if (value instanceof Date) {
    return { field, op: 'eq', value: value.toISOString() }
  }

  return undefined
}

/** query 表单值（扁平 bag）→ filters 数组；空 bag 返回 `[]`（wire 上恒有该槽位，便于日志对账） */
export function buildWalnutListFilters(query: Record<string, unknown> | null | undefined): BaseFilterParams {
  if (query === null || query === undefined) {
    return []
  }

  const filters: BaseFilterParams = []

  for (const [field, value] of Object.entries(query)) {
    const filter = buildWalnutListFilter(field, value)
    if (filter !== undefined) {
      filters.push(filter)
    }
  }

  return filters
}

/**
 * 表格 / 选择器的界面态 → list 请求体（**唯一 wire 构造点**）。
 *
 * 入参是 `{ query, sort, page }` 的界面态；出参是 contract 的 `BaseListParams`
 * （批次 4-A 起只有 filters / sort / page 三个槽位）。
 */
export function toWalnutListParams<T>(
  state: { query?: unknown, sort?: BaseSortParams<T>, page?: BasePageParams } | null | undefined,
): BaseListParams<T> {
  const payload: BaseListParams<T> = {
    filters: buildWalnutListFilters((state?.query ?? {}) as Record<string, unknown>),
  }

  if (state?.sort !== undefined) {
    payload.sort = state.sort
  }
  if (state?.page !== undefined) {
    payload.page = state.page
  }

  return payload
}

import type { BaseListParams, BasePageParams, BaseSortParams } from '@walnut/contract'
import { useState } from '@walnut/client/hooks/core/useState'
import { computed } from 'vue'
import { toWalnutListParams } from '@/utils/table/list-filters'

/**
 * 表格 list 的**界面态**（批次 4-A）。
 *
 * `query` 是 query 表单的扁平模型（直接绑在 `WForm :model` 上），**不是 wire 形态**：
 * 发请求时由 `toWalnutListParams` 翻成 `filters: [{ field, op, value }]`。
 * 这样表单控件（Input / Switch / DatePicker / Select）绑定面零改动，只有 wire 变了。
 */
export interface IWalnutTableListState<T> {
  query: T
  sort: BaseSortParams<T>
  page: BasePageParams
}

/**
 * 表格 list 参数的**唯一构造点**。
 *
 * 两个出口：
 * - `apiListParams`：界面态（query 冲突合并、分页翻页、`onGetApiListParams` 都改它）；
 * - `apiListFilters`：wire 形态（`listApi(params)` 收到的那个），由 query 现算。
 */
export function useTableAPIListParams<T>() {
  const {
    stateRef: apiListParams,
    resetState: resetParams,
    commit: commitParams,
  } = useState<IWalnutTableListState<T>>({
    query: {} as T,
    sort: [],
    page: {
      page: 1,
      pageSize: 10,
    },
  })

  const apiListFilters = computed<BaseListParams<T>>(() => toWalnutListParams<T>(apiListParams.value))

  return { apiListParams, apiListFilters, resetParams, commitParams }
}

export type ICompUITableHooksAPIListParams<T> = ReturnType<typeof useTableAPIListParams<T>>

import type { WTable } from '../types'
import { inject, provide } from 'vue'
import { AppConstSymbolKey } from '@/const/symbol'

const key = Symbol(AppConstSymbolKey.TABLE_KEY)
export function setTableContext<T>(ctx: WTable.Context<T>) {
  provide<WTable.Context<T>>(key, ctx)
}
export function useTableContext<T>(): WTable.Context<T> {
  return inject<WTable.Context<T>>(key)!
}

import type { WForm } from '../types'
import { inject, provide } from 'vue'
import { AppConstSymbolKey } from '@/const/symbol'

const key = Symbol(AppConstSymbolKey.FORM_KEY)
export function setFormContext<T>(ctx: WForm.Context<T>) {
  provide<WForm.Context<T>>(key, ctx)
}
export function useFormContext<T>(): WForm.Context<T> {
  return inject<WForm.Context<T>>(key)!
}

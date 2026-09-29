import type { InjectionKey } from 'vue'
import { AppConstSymbolKey } from '@/const/symbol'

export const tabsKey: InjectionKey<string | symbol> = Symbol(
  AppConstSymbolKey.TABS_KEY,
)

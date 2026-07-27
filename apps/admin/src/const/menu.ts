import type { ValueOf } from 'easy-fns-ts'
import { CacheKeyStrategy, MenuTernal, MenuType } from '@walnut/contract/menu'

// Re-export from @walnut/contract with backward-compatible aliases
export const AppConstMenuType = MenuType
export const AppConstMenuTernal = MenuTernal
export const AppConstCacheKeyStrategy = CacheKeyStrategy

export type ValueOfAppConstMenuType = ValueOf<typeof AppConstMenuType>
export type ValueOfAppConstMenuTernal = ValueOf<typeof AppConstMenuTernal>
export type ValueOfAppConstCacheKeyStrategy = ValueOf<typeof AppConstCacheKeyStrategy>

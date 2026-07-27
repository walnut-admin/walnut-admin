import type { ValueOf } from 'easy-fns-ts'
import { Locale } from '@walnut/contract/i18n'

// Re-export from @walnut/contract — single source of truth
export const WalnutAdminConstAppLanguage = Locale

export type IWalnutAdminConstAppLanguage = ValueOf<typeof WalnutAdminConstAppLanguage>

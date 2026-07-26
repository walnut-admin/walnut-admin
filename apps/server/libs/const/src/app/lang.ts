import type { ValueOf } from 'easy-fns-ts'

// app supported languages
export const WalnutAdminConstAppLanguage = {
  zh_CN: 'zh_CN',
  en_US: 'en_US',
} as const

export type IWalnutAdminConstAppLanguage = ValueOf<
  typeof WalnutAdminConstAppLanguage
>

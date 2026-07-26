import type { ValueOf } from 'easy-fns-ts'

export const WalnutAdminConstAppEnv = {
  DEV: 'development',
  STAGE: 'stage',
  PROD: 'production',
} as const

export type IWalnutAdminConstAppEnv = ValueOf<
  typeof WalnutAdminConstAppEnv
>

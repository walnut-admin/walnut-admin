import type { ValueOf } from 'easy-fns-ts'

export const WalnutAdminConstAppPermissionType = {
  STRINGS: 'strings' as const,
  ROUTES: 'routes' as const,
  MENUS: 'menus' as const,
  ALL: 'all' as const,
} as const

export type IWalnutAdminConstAppPermissionType = ValueOf<
    typeof WalnutAdminConstAppPermissionType
>

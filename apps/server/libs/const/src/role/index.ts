import type { ValueOf } from 'easy-fns-ts'

export const WalnutAdminConstRole = {
  ROOT: 'root',
  DEVELOPER: 'developer',
  ADMIN: 'admin',
  VISITOR: 'visitor',
} as const

export type IWalnutAdminConstRole = ValueOf<typeof WalnutAdminConstRole>

export const WalnutAdminConstRoleMode = {
  SWITCH: 'switchable',
  COMBINE: 'combinable',
} as const

export type IWalnutAdminConstRoleMode = ValueOf<
  typeof WalnutAdminConstRoleMode
>

export const WalnutAdminConstRoleRootId = '68635668a1f084bfd66da715'
export const WalnutAdminConstRoleDeveloperId = '6863567ba1f084bfd66da71b'
// root/developer role/user id
export const WalnutAdminConstSafeUserId = ['68635bd771f9cd6b4fa8f1f9', '686363c61dbc81480db356e3']
export const WalnutAdminConstSafeRoleId = [WalnutAdminConstRoleRootId, WalnutAdminConstRoleDeveloperId]

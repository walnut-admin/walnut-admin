import type { ValueOf } from 'easy-fns-ts'

export const WalnutAdminConstDecoratorRoleMetadataKey = {
  ROLE: 'WALNUT_ADMIN_CONST_DECORATOR_METADATAKEY_ROLE',
  ROLE_MODE: 'WALNUT_ADMIN_CONST_DECORATOR_METADATAKEY_ROLE_MODE',
} as const

export const WalnutAdminConstDecoratorRoleMode = {
  AND: 'and',
  OR: 'or',
} as const

/**
 * @description This requires permission to be a string array
 * `and` means current user need to match *all the permission strings passed in*
 * `or` means current user only need to match *one of all the permission strings passed in*
 * @default and
 */
export type IWalnutAdminConstDecoratorRoleMode = ValueOf<
  typeof WalnutAdminConstDecoratorRoleMode
>

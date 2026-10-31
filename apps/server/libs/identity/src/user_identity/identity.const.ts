/**
 * User Identity Module Constants
 * （自 schema/user_identity.schema.ts 搬出：schema 只留 DTO 元数据类，业务常量归 const 文件）
 */

import type { ValueOf } from 'easy-fns-ts'

// Identity type constants
export const WalnutAdminConstSysUserIdentityType = {
  PHONE_NUMBER: 'phoneNumber',
  EMAIL_ADDRESS: 'emailAddress',
  ID_CARD: 'idCard',
  PASSWORD: 'password',
} as const

export type IWalnutAdminConstSysUserIdentityType = ValueOf<typeof WalnutAdminConstSysUserIdentityType>

// Identity purpose constants
export const WalnutAdminConstSysUserIdentityPurpose = {
  LOGIN: 'login',
  SECURITY: 'security',
} as const

export type IWalnutAdminConstSysUserIdentityPurpose = ValueOf<typeof WalnutAdminConstSysUserIdentityPurpose>

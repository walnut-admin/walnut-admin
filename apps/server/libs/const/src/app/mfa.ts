/**
 * User MFA Module Constants
 * （自 schema/user_mfa.schema.ts 搬出：schema 只留 DTO 元数据类，业务常量归 const 文件）
 */

import type { ValueOf } from 'easy-fns-ts'

export const WalnutAdminConstSysUserMfaType = [
  'totp',
  'webauthn',
] as const

export type IWalnutAdminConstSysUserMfaType = ValueOf<
  typeof WalnutAdminConstSysUserMfaType
>

export const WalnutAdminConstSysUserMfaWebauthnTransport = [
  'usb',
  'ble',
  'nfc',
  'internal',
  'hybrid',
] as const

export type IWalnutAdminConstSysUserMfaWebauthnTransport = ValueOf<
  typeof WalnutAdminConstSysUserMfaWebauthnTransport
>

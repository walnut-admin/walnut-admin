/**
 * User MFA module constants — shared between frontend and backend.
 */

export const WalnutAdminConstSysUserMfaType = [
  'totp',
  'webauthn',
] as const

// 数组常量取元素联合：ValueOf<T> 是 T[keyof T]，对数组会把 length / 数组方法也算进来
export type IWalnutAdminConstSysUserMfaType = (typeof WalnutAdminConstSysUserMfaType)[number]

export const WalnutAdminConstSysUserMfaWebauthnTransport = [
  'usb',
  'ble',
  'nfc',
  'internal',
  'hybrid',
] as const

export type IWalnutAdminConstSysUserMfaWebauthnTransport = (typeof WalnutAdminConstSysUserMfaWebauthnTransport)[number]

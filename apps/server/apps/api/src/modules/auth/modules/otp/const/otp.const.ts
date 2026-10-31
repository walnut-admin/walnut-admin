/**
 * OTP Module Constants
 * One-Time Password authentication for Email and SMS
 */

import type { IOtpType as IIdentityOtpType, IWalnutAdminConstSysUserIdentityType } from '@walnut-server/identity'
import { WalnutAdminConstSysUserIdentityType } from '@walnut-server/identity'

export const otpType = {
  email: 'email',
  sms: 'sms',
} as const

/**
 * OTP Type - distinguishes between email and SMS verification
 */
/** 批 6：类型真源随身份内核下沉；本别名保持 auth 侧既有 import 面。 */
export type IOtpType = IIdentityOtpType

/**
 * Passport strategy name for OTP authentication
 */
export const WALNUT_ADMIN_OTP_STRATEGY = 'WALNUT_ADMIN_JWT_LOCAL_OTP'

/**
 * Identity type mapping for user_identity table
 */
export const OtpIdentityTypeMap: Record<IOtpType, IWalnutAdminConstSysUserIdentityType> = {
  email: WalnutAdminConstSysUserIdentityType.EMAIL_ADDRESS,
  sms: WalnutAdminConstSysUserIdentityType.PHONE_NUMBER,
}

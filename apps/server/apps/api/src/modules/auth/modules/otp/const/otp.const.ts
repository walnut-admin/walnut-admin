/**
 * OTP Module Constants
 * One-Time Password authentication for Email and SMS
 */

import type { ValueOf } from 'easy-fns-ts'
import type { IWalnutAdminConstSysUserIdentityType } from '@/modules/system/user_identity/schema/user_identity.schema'
import { WalnutAdminConstSysUserIdentityType } from '@/modules/system/user_identity/schema/user_identity.schema'

export const otpType = {
  email: 'email',
  sms: 'sms',
} as const

/**
 * OTP Type - distinguishes between email and SMS verification
 */
export type IOtpType = ValueOf<typeof otpType>

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

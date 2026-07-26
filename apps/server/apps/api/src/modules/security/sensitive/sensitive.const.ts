// sensitive.const.ts
import type { ValueOf } from 'easy-fns-ts'

/**
 * Security levels for sensitive operations
 */
export const WalnutAdminConstSecurityLevel = {
  BASIC: 'basic', // Basic sensitive operations
  ACCOUNT_CRITICAL: 'account_critical', // Account critical operations
  FINANCIAL: 'financial', // Financial operations
  ADMIN_CRITICAL: 'admin_critical', // Admin critical operations
} as const

export type IWalnutAdminConstSecurityLevel = ValueOf<typeof WalnutAdminConstSecurityLevel>

/**
 * Sensitive operation types
 */
export const WalnutAdminConstSecuritySensitiveType = {
  // Account operations
  PASSWORD_CHANGE: 'password_change',
  EMAIL_CHANGE: 'email_change',
  EMAIL_BIND: 'email_bind',
  EMAIL_STATUS_TOGGLE: 'email_status_toggle',
  PHONE_CHANGE: 'phone_change',
  PHONE_BIND: 'phone_bind',
  PHONE_STATUS_TOGGLE: 'phone_status_toggle',
} as const

export type IWalnutAdminConstSecuritySensitiveType = ValueOf<typeof WalnutAdminConstSecuritySensitiveType>

/**
 * Verification methods
 */
export const WalnutAdminConstVerifyMethod = {
  PASSWORD: 'password',
  SMS: 'sms',
  MFA: 'mfa',
  EMAIL: 'email',
} as const

export type IWalnutAdminConstVerifyMethod = ValueOf<typeof WalnutAdminConstVerifyMethod>

/**
 * Verification strength levels
 */
export const WalnutAdminConstVerifyStrength = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
} as const

export type IWalnutAdminConstVerifyStrength = ValueOf<typeof WalnutAdminConstVerifyStrength>

import type { SystemUserIdentityPurpose } from '@walnut/api-types'
import type { IWalnutAdminConstSysUserMfaType } from '@walnut/contract/mfa'
/**
 * Secondary Authentication Types
 * Unified secondary authentication for sensitive operations
 */

/**
 * Supported authentication method types
 * （MFA 两档来自 @walnut/contract，前后端同一值集）
 */
export type VerifyAuthMethodType = 'sms' | 'email' | IWalnutAdminConstSysUserMfaType

/**
 * Flow mode - determines which flow to use
 * 'verify' - User already has bound method, just verify
 * 'bind' - User needs to bind method first (input identifier then verify)
 */
export type VerifyAuthFlowMode = 'verify' | 'bind'

/**
 * Current step in the authentication flow
 */
export type VerifyAuthStep = 'select' | 'input' | 'verify'

/**
 * Authentication method configuration
 */
export interface VerifyAuthMethod {
  /** Unique key for the method */
  type: VerifyAuthMethodType
  /** Display name (i18n key resolved) */
  name: string
  /** Description (i18n key resolved) */
  description: string
  /** Icon name for the method */
  icon: string
  /** Whether this method is available/enabled for the user */
  enabled: boolean
  /** Masked identifier (e.g., phone number or email) */
  maskedValue?: string
  /** Whether user has bound this method */
  bound: boolean
}

/**
 * 40119（敏感操作需要二次验证）的挑战上下文。
 *
 * 两个字段都来自服务端 40119 响应的 `meta`，**不要在前端写死**：`level` 决定授权键落在
 * 哪一档（`sensitive_op:<userId>:<deviceId>:<level>`），`operationType` 决定服务端的
 * 可用方式策略并按 verify 端点的必填项校验。设置它 = 「这次验证是为敏感操作放行」：
 * 组件会先发码、并把码交给 `POST /security/sensitive/verify`，而不是只做身份 verify。
 */
export interface VerifyAuthSensitiveChallenge {
  /** 服务端安全等级（basic / account_critical / financial / admin_critical） */
  level: string
  /** 敏感操作类型（identity_manage / email_status_toggle / …） */
  operationType: string
}

/**
 * TODO need to optimise this type
 * Options for opening the secondary auth modal
 */
export interface VerifyAuthOptions {
  /** Flow mode - 'verify' for existing methods, 'bind' for first-time binding */
  mode?: VerifyAuthFlowMode
  /** Pre-selected method type - skips selection step */
  preSelectedMethod?: VerifyAuthMethodType
  /** Allowed authentication methods - defaults to all available */
  allowedMethods?: VerifyAuthMethodType[]
  /** Whether to show "trust this device" checkbox - defaults to true */
  showTrusted?: boolean
  /** Purpose for the API calls ('login' | 'security') - defaults to 'security' */
  purpose?: SystemUserIdentityPurpose
  /** Whether to show "set as security" option (for bind mode) - defaults to false */
  showSetAsSecurity?: boolean
  /** 40119 挑战上下文；给了它就走敏感操作验证（发码 + /security/sensitive/verify） */
  sensitive?: VerifyAuthSensitiveChallenge
}

/**
 * Result of the secondary authentication
 */
export interface VerifyAuthResult {
  /** Whether the verification was successful */
  verified: boolean
  /** The method used for verification */
  method?: VerifyAuthMethodType
  /** Whether the user chose to trust this device */
  trusted: boolean
  /** Whether user chose to set as security method (for bind mode) */
  setAsSecurity?: boolean
  /** Error message if verification failed */
  error?: string
}

/**
 * Props for the VerifyAuth component
 */
export interface VerifyAuthProps {
  /** Control modal visibility */
  show: boolean
  /** Options for configuring the modal */
  options?: VerifyAuthOptions
}

/**
 * Events emitted by the VerifyAuth component
 */
export interface VerifyAuthEmits {
  /** Update show state */
  (e: 'update:show', value: boolean): void
  /** Verification successful */
  (e: 'verified', result: VerifyAuthResult): void
  /** Binding successful (only for bind mode) */
  (e: 'bound', result: VerifyAuthResult): void
  /** Verification cancelled/closed */
  (e: 'cancelled'): void
}

/**
 * Form data for phone input (bind mode)
 */
export interface PhoneFormData {
  identifier: string | null
  setAsSecurity: boolean
}

/**
 * Form data for email input (bind mode)
 */
export interface EmailFormData {
  identifier: string | null
  setAsSecurity: boolean
}

/**
 * Form data for verification code
 */
export interface VerifyFormData {
  verifyCode: string[]
}

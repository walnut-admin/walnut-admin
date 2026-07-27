// Re-export from @walnut/contract — single source of truth for response codes
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'

export { WalnutAdminConstAppResponseCode }

/**
 * @deprecated Use WalnutAdminConstAppResponseCode instead.
 * Kept for backward compatibility — will be removed in a future version.
 */
export const BusinessCodeConst = {
  SUCCESS: WalnutAdminConstAppResponseCode.SUCCESS,

  RSA_DECRYPT_FAILED: WalnutAdminConstAppResponseCode.BAD_REQUEST_DECRYPT_FAILED,
  RSA_PUB_KEY_NOT_FOUND: WalnutAdminConstAppResponseCode.BAD_REQUEST_RSA_PUB_KEY_NOT_FOUND,
  ACCESS_TOKEN_EXPIRED: WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED,
  REFRESH_TOKEN_EXPIRED: WalnutAdminConstAppResponseCode.UNAUTHORIZED_REFRESH_TOKEN_EXPIRED,
  SIGNATURE_EXPIRED: WalnutAdminConstAppResponseCode.UNAUTHORIZED_EXPIRED_SIGNATURE,
  MFA_REQUIRED: WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_REQUIRED,
  MFA_VERIFIED: WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED,
  CAPJS_TOKEN_INTERACTION_REQUIRED: WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED,
  CAPJS_TOKEN_REFRESH_REQUIRED: WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_REFRESH_REQUIRED,
  USER_LOCKED: WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED,
  SENSITIVE_VERIFICATION_REQUIRED: WalnutAdminConstAppResponseCode.UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED,
} as const

/**
 * @deprecated Use WalnutAdminConstAppResponseCode instead.
 * Kept for backward compatibility — will be removed in a future version.
 */
export const notAllowedErrorCodeMap: Record<number, string> = {
  [WalnutAdminConstAppResponseCode.UNAUTHORIZED_BOT_VERIFY_FAILED]: 'capjsTokenInvalid',
  [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE]: 'notAllowed',
  [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_OS_UNSUPPORTED]: 'os',
  [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BROWSER_UNSUPPORTED]: 'browser',
  [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED]: 'ip',
  [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_USER_AGENT_UNSUPPORTED]: 'userAgent',
  [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED]: 'device',
  [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_LOCKED]: 'deviceLocked',
  [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_BANNED]: 'deviceBanned',
  [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_RISK_TOO_HIGH]: 'riskTooHigh',
  [WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS]: 'tooManyRequests',
}

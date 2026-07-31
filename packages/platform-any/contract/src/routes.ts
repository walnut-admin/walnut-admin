/**
 * Shared API route constants — single source of truth for frontend + backend.
 * Consumers should migrate incrementally from hardcoded paths to these constants.
 */

// ============ Authentication ============
export const AuthRoutes = {
  SIGNOUT: '/auth/signout',
  REFRESH: '/auth/refresh',
  PERMISSIONS: '/auth/permissions',
  KEYS: '/auth/keys',
  MFA_STATUS: '/auth/mfa/status',
  MFA_VERIFY: '/auth/mfa/verify',
  OTP_SEND: '/auth/otp/send',
  OTP_VERIFY: '/auth/otp/verify',
  GOOGLE: '/auth/google',
  OAUTH_GITHUB_URL: '/auth/oauth/github/url',
  OAUTH_GITEE_URL: '/auth/oauth/gitee/url',
} as const

// ============ System CRUD module prefixes ============
export const SystemRoutes = {
  USER: '/system/user',
  ROLE: '/system/role',
  MENU: '/system/menu',
  DICT_TYPE: '/system/dict/type',
  DICT_DATA: '/system/dict/data',
  LOCALE: '/system/locale',
  LANG: '/system/lang',
  DEVICE: '/system/device',
  DELETED: '/system/deleted',
  LOG_OPERATE: '/system/log/operate',
  LOG_AUTH: '/system/log/auth',
} as const

// ============ System named endpoints ============
export const SystemEndpointRoutes = {
  USER_ME_PROFILE: '/system/user/me/profile',
  USER_ME_SWITCH_ROLE: '/system/user/me/role/switch',
  USER_LOCK: '/system/user/lock',
  USER_LOCK_UNLOCK: '/system/user/lock/unlock',
  USER_PREFERENCE: '/system/user/preference',
  USER_IDENTITY_STATUS: '/system/user/identity/status',
  USER_IDENTITY_CHECK: '/system/user/identity/check',
  USER_IDENTITY_BIND: '/system/user/identity/bind',
  USER_IDENTITY_UNBIND: '/system/user/identity/unbind',
  USER_IDENTITY_SEND_CODE: '/system/user/identity/send-code',
  USER_IDENTITY_VERIFY: '/system/user/identity/verify',
  USER_DEVICE_LIST: '/system/user/device/list',
  DEVICE_INITIAL: '/system/device/initial',
  MENU_TREE: '/system/menu/tree',
  LANG_LIST_PUBLIC: '/system/lang/list/public',
  LOCALE_MESSAGE: '/system/locale/message',
  DICT_TYPE_S: '/system/dict/type/s',
  DELETED_RECOVER: '/system/deleted/recover',
} as const

// ============ Application ============
export const AppRoutes = {
  SETTING_PUBLIC: '/app/setting/public',
  SETTING_PRIVATE: '/app/setting/private',
  SETTING_CACHE_REFRESH: '/app/setting/cache/refresh',
  KEY_CURRENT: '/app/key/current',
} as const

// ============ Security ============
export const SecurityRoutes = {
  CAP_CHALLENGE: '/security/cap/challenge',
  CAP_REDEEM: '/security/cap/redeem',
  RSA_PUBLIC_KEY: '/security/rsa/public-key',
  SIGN_INITIAL: '/security/sign/initial',
  SIGN_AES_KEY: '/security/sign/aes-key',
} as const

// ============ Shared ============
export const SharedRoutes = {
  ALI_STS: '/shared/ali/sts',
  AREA_CHILDREN: '/shared/area/children',
  AREA_FEEDBACK: '/shared/area/feedback',
} as const

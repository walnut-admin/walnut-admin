import type { ValueOf } from 'easy-fns-ts'

// global cache keys
export const WalnutAdminConstAppCacheKeys = {
  SHARED_AREA_PROVINCE: 'SHARED:AREA:PROVINCE',
  SHARED_AREA_CITY: 'SHARED:AREA:CITY',
  SHARED_AREA_DISTRICT: 'SHARED:AREA:DISTRICT',
  SHARED_AREA_STREET: 'SHARED:AREA:STREET',
  SHARED_AREA_VILLAGE: 'SHARED:AREA:VILLAGE',

  APP_SETTING: 'APP:SETTING',
  APP_MURLOCK: 'APP:MURLOCK',

  AUTH_PERMISSIONS: 'AUTH:PERMISSIONS',
  AUTH_SESSIONS: 'AUTH:SESSIONS',
  AUTH_OPAQUE_STATE: 'AUTH:OPAQUE_STATE',
  AUTH_MFA_VERIFIED: 'AUTH:MFA:VERIFIED',
  AUTH_MFA_TOTP: 'AUTH:MFA:TOTP',
  AUTH_MFA_WEBAUTN: 'AUTH:MFA:WEBAUTN',
  AUTH_VERIFY_CODE: 'AUTH:VERIFY_CODE',

  SECURITY_LOCK: 'SECURITY:LOCK',
  SECURITY_RSA_PUB_KEY: 'SECURITY:RSA:PUB_KEY',
  SECURITY_SIGN_TICKET: 'SECURITY:SIGN:TICKET',
  SECURITY_SIGN_AES_KEY: 'SECURITY:SIGN:AES_KEY',
  SECURITY_SIGN_NONCE: 'SECURITY:SIGN:NONCE',
  SECURITY_CAP_TOKEN: 'SECURITY:CAP_TOKEN',

  SYS_LOCALE_MESSAGES: 'SYSTEM:LOCALE',
  SYS_LANG_LIST_PUBLIC: 'SYSTEM:LANGUAGE:PUBLIC_LIST',
  SYS_LANG_ID_LIST: 'SYSTEM:LANGUAGE:ID_LIST',
  SYS_DEVICE: 'SYSTEM:DEVICE',
} as const

export type IWalnutAdminConstAppCacheKeys = ValueOf<
  typeof WalnutAdminConstAppCacheKeys
>

// global cache type
export const WalnutAdminConstAppCacheType = {
  // cannot be clean through controller
  BUILT_IN: 'built-in',
  AUTH: 'auth',
  CONTROLLER: 'controller',
  SHARED: 'shared',
  SYSTEM: 'system',
} as const

export type IWalnutAdminConstAppCacheType = ValueOf<
  typeof WalnutAdminConstAppCacheType
>

// system setting keys
export const WalnutAdminConstAppSettingKeys = {
  APP_GLOBAL_IP_BLACKLIST: 'app.global.ipBlackList',
  APP_GLOBAL_OS_WHITELIST: 'app.global.osWhiteList',
  APP_GLOBAL_BROWSER_WHITELIST: 'app.global.browserWhiteList',
  APP_GLOBAL_CAPJS_CONFIG: 'app.global.capjs.config',
  APP_GLOBAL_FORCE_QUIT_CONFIG: 'app.global.forceQuit.config',
  APP_GLOBAL_CRYPTO_HKDF: 'app.crypto.hkdfInfo',

  APP_FUNCTIONAL_ROLE: 'app.functional.role',
  APP_FUNCTIONAL_FRONT: 'app.functional.front',

  APP_FUNCTIONAL_FRONT_MASK_URL: 'app.functional.front.maskUrl',
  APP_FUNCTIONAL_FRONT_HIJACK_REFRESH: 'app.functional.front.hijackRefresh',
  APP_FUNCTIONAL_FRONT_WATERMARK: 'app.functional.front.watermark',
  APP_FUNCTIONAL_FRONT_TRANSITION: 'app.functional.front.transition',

  APP_AUTH_MFA: 'app.auth.mfa',

  APP_AUTH_EMAIL: 'app.auth.email',
  APP_AUTH_PHONE: 'app.auth.phone',

  APP_AUTH_OPAQUE: 'app.auth.opaque',
  APP_AUTH_QR: 'app.auth.qrcode',
  APP_AUTH_GITEE: 'app.auth.gitee',
  APP_AUTH_GITHUB: 'app.auth.github',
  APP_AUTH_GOOGLE: 'app.auth.google',
} as const

export type IWalnutAdminConstAppSettingKeys = ValueOf<
  typeof WalnutAdminConstAppSettingKeys
>

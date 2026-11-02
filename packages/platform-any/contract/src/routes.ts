/**
 * Shared API route constants — single source of truth for frontend + backend.
 * Consumers should migrate incrementally from hardcoded paths to these constants.
 */

// ============ Authentication ============
export const AuthRoutes = {
  BASE: '/auth',
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
  // controller 前缀（@Controller('...')）—— 与 apps/server 的 AuthMfa / Otp / OAuth* /
  // Opaque* controller 一一对应；方法级命名端点按需再加
  MFA: '/auth/mfa',
  OTP: '/auth/otp',
  OAUTH_GITHUB: '/auth/oauth/github',
  OAUTH_GITEE: '/auth/oauth/gitee',
  OPAQUE_ADMIN: '/auth/opaque/admin',
  OPAQUE_USER: '/auth/opaque/user',
  // 方法级命名端点（admin 实际调用点；server 侧方法级保留相对字面量——Nest 方法路径
  // 相对 controller 前缀，绝对常量会改变路由，由 openapi 零 diff 兜底）
  OPAQUE_ADMIN_PASSWORD_UPDATE_START: '/auth/opaque/admin/password/update/start',
  OPAQUE_ADMIN_PASSWORD_UPDATE_FINISH: '/auth/opaque/admin/password/update/finish',
  OPAQUE_ADMIN_PASSWORD_CLEAR: '/auth/opaque/admin/password/clear',
  OPAQUE_USER_LOGIN_START: '/auth/opaque/user/login/start',
  OPAQUE_USER_LOGIN_FINISH: '/auth/opaque/user/login/finish',
  OPAQUE_USER_LOGIN_CLIENT_ERROR: '/auth/opaque/user/login/client-error',
  OPAQUE_USER_CHANGE_PASSWORD_START: '/auth/opaque/user/change-password/start',
  OPAQUE_USER_CHANGE_PASSWORD_FINISH: '/auth/opaque/user/change-password/finish',
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
  // 其余 controller 前缀（与 apps/server 的 SysDept / SysEmployee / SysPost /
  // SysUser* / SysUserMfa* controller 一一对应）
  DEPT: '/system/dept',
  EMPLOYEE: '/system/employee',
  POST: '/system/post',
  USER_ME: '/system/user/me',
  USER_DEVICE: '/system/user/device',
  USER_IDENTITY: '/system/user/identity',
  USER_OAUTH: '/system/user/oauth',
  USER_MFA_TOTP: '/system/user/mfa/totp',
  USER_MFA_WEBAUTHN: '/system/user/mfa/webauthn',
} as const

// ============ System named endpoints ============
export const SystemEndpointRoutes = {
  USER_ME_PROFILE: '/system/user/me/profile',
  USER_ME_SWITCH_ROLE: '/system/user/me/role/switch',
  USER_ME_SECURITY_TAB2: '/system/user/me/security-tab2',
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
  USER_DEVICE_UPDATE_NAME: '/system/user/device/update-name',
  USER_DEVICE_FORCE_QUIT: '/system/user/device/force-quit',
  USER_DEVICE_LOCK: '/system/user/device/lock',
  USER_DEVICE_UNLOCK: '/system/user/device/unlock',
  USER_MFA_TOTP_GENERATE: '/system/user/mfa/totp/generate',
  USER_MFA_TOTP_VERIFY: '/system/user/mfa/totp/verify',
  USER_MFA_TOTP_BIND: '/system/user/mfa/totp/bind',
  USER_MFA_TOTP_UNBIND: '/system/user/mfa/totp/unbind',
  USER_MFA_TOTP_STATUS: '/system/user/mfa/totp/status',
  USER_MFA_WEBAUTHN_REGISTER_OPTIONS: '/system/user/mfa/webauthn/register/options',
  USER_MFA_WEBAUTHN_REGISTER_VERIFY: '/system/user/mfa/webauthn/register/verify',
  USER_MFA_WEBAUTHN_AUTHENTICATE_OPTIONS: '/system/user/mfa/webauthn/authenticate/options',
  USER_MFA_WEBAUTHN_AUTHENTICATE_VERIFY: '/system/user/mfa/webauthn/authenticate/verify',
  USER_LOCK_READ: '/system/user/lock/read',
  USER_PREFERENCE_READ: '/system/user/preference/read',
  USER_PREFERENCE_BASIC: '/system/user/preference/basic',
  USER_PREFERENCE_ACCESSIBILITY: '/system/user/preference/accessibility',
  USER_PREFERENCE_THEME: '/system/user/preference/theme',
  USER_PREFERENCE_LAYOUT: '/system/user/preference/layout',
  DEVICE_INITIAL: '/system/device/initial',
  MENU_TREE: '/system/menu/tree',
  DEPT_TREE: '/system/dept/tree',
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
  KEY_AES_URL: '/app/key/current/AES_KEY_URL',
  DEPS: '/deps',
  MONITOR_SERVER_CPU: '/app/monitor/server/cpu',
  MONITOR_SERVER_MEM: '/app/monitor/server/mem',
  MONITOR_SERVER_OS: '/app/monitor/server/os',
  MONITOR_SERVER_SYS: '/app/monitor/server/sys',
  MONITOR_SERVER_DISK: '/app/monitor/server/disk',
  MONITOR_SERVER_BATTERY: '/app/monitor/server/battery',
  MONITOR_SERVER_TIME: '/app/monitor/server/time',
  MONITOR_SERVER_NETWORK: '/app/monitor/server/network',
  // controller 前缀（@Controller('...')）—— 与 apps/server 的 AppRoot / AppSetting /
  // AppKey / AppLogger / AppHealth / AppDemo / AppError / AppMonitor* controller 一一对应
  ROOT: '/',
  SETTING: '/app/setting',
  KEY: '/app/key',
  LOGGER: '/app/logger',
  HEALTH: '/app/health',
  DEMO: '/app/demo',
  ERROR: '/app/error',
  MONITOR_SERVER: '/app/monitor/server',
  MONITOR_CACHE: '/app/monitor/cache',
  MONITOR_USER: '/app/monitor/user',
} as const

// ============ Security ============
export const SecurityRoutes = {
  CAP_CHALLENGE: '/security/cap/challenge',
  CAP_REDEEM: '/security/cap/redeem',
  RSA_PUBLIC_KEY: '/security/rsa/public-key',
  SIGN_INITIAL: '/security/sign/initial',
  SIGN_AES_KEY: '/security/sign/aes-key',
  // controller 前缀（@Controller('...')）
  CAP: '/security/cap',
  RSA: '/security/rsa',
  SENSITIVE: '/security/sensitive',
  SIGN: '/security/sign',
} as const

// ============ Shared ============
export const SharedRoutes = {
  ALI_STS: '/shared/ali/sts',
  AREA_CHILDREN: '/shared/area/children',
  AREA_FEEDBACK: '/shared/area/feedback',
  // controller 前缀（@Controller('...')）
  ALI: '/shared/ali',
  AREA: '/shared/area',
} as const

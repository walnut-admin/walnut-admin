import type { ValueOf } from 'easy-fns-ts'

export const WalnutAdminConstAppSettingScopeType = {
  GLOBAL: 'global',
  LOCAL: 'local',
} as const

export type IWalnutAdminConstAppSettingScopeType = ValueOf<typeof WalnutAdminConstAppSettingScopeType>

// system setting type, extend this as need grow
export const WalnutAdminConstAppSettingType = {
  AUTH: 'auth',
  GLOBAL: 'global',
  FUNCTIONAL: 'functional',
} as const

export type IWalnutAdminConstAppSettingType = ValueOf<typeof WalnutAdminConstAppSettingType>

export const WalnutAdminConstAppSettingForceQuitStrategy = {
  FORCE_COUNTDOWN_MODAL: 'FORCE_COUNTDOWN_MODAL',
  MANUAL_COUNTDOWN_MODAL: 'MANUAL_COUNTDOWN_MODAL',
  FORCE_IMMEDIATE_SIGNOUT: 'FORCE_IMMEDIATE_SIGNOUT',
} as const

export type IWalnutAdminConstAppSettingForceQuitStrategy = ValueOf<typeof WalnutAdminConstAppSettingForceQuitStrategy>

export const WalnutAdminConstRevokeRTType = {
  updatePass: 'updatePass',
  resetPass: 'resetPass',
  updateEmail: 'updateEmail',
  updatePhoneNumber: 'updatePhoneNumber',
  forceQuitOnline: 'forceQuitOnline',
  forceQuitOffline: 'forceQuitOffline',
  currentRoleBanned: 'currentRoleBanned',
  currentUserBanned: 'currentUserBanned',
  deviceBanned: 'deviceBanned',
  deviceHighRisk: 'deviceHighRisk',
  versionUpgrade: 'versionUpgrade',
  userKickOther: 'userKickOther',
} as const

export type IWalnutAdminConstRevokeRTType = ValueOf<typeof WalnutAdminConstRevokeRTType>

// force quit setting keys
export interface IWalnutAdminConstAppSettingForceQuit {
  updatePass: IWalnutAdminConstAppSettingForceQuitStrategy
  resetPass: IWalnutAdminConstAppSettingForceQuitStrategy
  updateEmail: IWalnutAdminConstAppSettingForceQuitStrategy
  updatePhoneNumber: IWalnutAdminConstAppSettingForceQuitStrategy
  forceQuitOnline: IWalnutAdminConstAppSettingForceQuitStrategy
  forceQuitOffline: IWalnutAdminConstAppSettingForceQuitStrategy
  currentRoleBanned: IWalnutAdminConstAppSettingForceQuitStrategy
  currentUserBanned: IWalnutAdminConstAppSettingForceQuitStrategy
  deviceBanned: IWalnutAdminConstAppSettingForceQuitStrategy
  deviceHighRisk: IWalnutAdminConstAppSettingForceQuitStrategy
  versionUpgrade: IWalnutAdminConstAppSettingForceQuitStrategy
  userKickOther: IWalnutAdminConstAppSettingForceQuitStrategy
}

// crypto hkdf setting keys
export interface IWalnutAdminConstAppSettingCryptoHKDFKeys {
  API_SIGN: string
}

// mfa setting keys
export interface IWalnutAdminConstAppSettingMfaKeys {
  methodsRequiredCount: number
}

// capjs setting keys
export interface IWalnutAdminConstAppSettingCapJSKeys {
  count: number
  size: number
  difficulty: number
  ttl: number

  throttleLimit: number
  throttleTtl: number
}

// email auth setting keys
export interface IWalnutAdminConstAppSettingAuthEmailKeys {
  authEnable: number
  newUserSignup: number
  sendEnable: number
  verifyFigure: number
  verifyTtl: number
  sendLimit: number
  sendTtl: number
}

// sms auth setting keys
export interface IWalnutAdminConstAppSettingAuthSmsKeys {
  authEnable: number
  newUserSignup: number
  sendEnable: number
  verifyFigure: number
  verifyTtl: number
  sendLimit: number
  sendTtl: number
}

// oauth github setting keys
export interface IWalnutAdminConstAppSettingAuthOAuthGitHubKeys {
  authEnable: number
  newUserSignup: number
}

// oauth gitee setting keys
export interface IWalnutAdminConstAppSettingAuthOAuthGiteeKeys {
  authEnable: number
  newUserSignup: number
}

// google auth setting keys
export interface IWalnutAdminConstAppSettingAuthOAuthGoogleKeys {
  authEnable: number
  newUserSignup: number
}

// opaque auth setting keys
export interface IWalnutAdminConstAppSettingAuthOpaqueKeys {
  authEnable: number
  register: number
  forget: number
  change: number
}

// scope resolver config
export interface IWalnutAdminScopeResolverConfig<T> {
  scope: IWalnutAdminConstAppSettingScopeType
  globalValue: T
  localKey: string
}

// functional role setting keys
export interface IWalnutAdminConstAppSettingFunctionalRoleKeys<T> extends IWalnutAdminScopeResolverConfig<T> {
  defaultRole: string
}

// functional frontend scope setting keys
export interface IWalnutAdminConstAppSettingFunctionalFrontendScopeKeys<T> extends IWalnutAdminScopeResolverConfig<T> {
  status: boolean
}

// functional pure frontend
export interface IWalnutAdminConstAppSettingFunctionalFrontendKeys {
  fullScreen: number
  search: number
  dark: number
  locale: number
}

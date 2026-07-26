import type { IWalnutAdminConstDecoratorLogAuthType } from '@walnut/const/decorator/logAuth'

declare global {
  // ========== Constants Types ==========
  type IWalnutAdminConstRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

  type IWalnutAdminConstRiskType =
    | 'IP'
    | 'DEVICE'
    | 'USER'
    | 'USER_DEVICE'
    | 'FAILED_LOGIN'
    | 'LOCATION'
    | 'RATE'
    | 'BEFORE_AUTH'
    | 'AFTER_AUTH'
    | 'COMPREHENSIVE'

  type IWalnutAdminConstRiskFactor =
    | 'IP_BLACKLIST_PERMANENT'
    | 'IP_BLACKLIST_TEMPORARY'
    | 'DEVICE_NEW'
    | 'DEVICE_RECENT'
    | 'DEVICE_CURRENT_IP_BLACKLISTED'
    | 'DEVICE_HISTORY_IP_BLACKLISTED'
    | 'DEVICE_BANNED'
    | 'DEVICE_LOCKED'
    | 'DEVICE_PRIVATE'
    | 'USER_DISABLED'
    | 'USER_NO_PASSWORD'
    | 'USER_NO_MFA'
    | 'USER_DEVICE_LOCKED'
    | 'USER_DEVICE_UNTRUSTED'
    | 'USER_DEVICE_TRUST_EXPIRED'
    | 'USER_DEVICE_INACTIVE'
    | 'LOCATION_HIGH_RISK_COUNTRY'
    | 'LOCATION_VPN_OR_PROXY'
    | 'LOCATION_JUMP'
    | 'FAILED_LOGINS'
    | 'RATE_LIMIT_EXCEEDED'

  type IWalnutAdminRiskFactorStage = 'pre-auth' | 'post-auth' | 'both'

  // ========== Base Types ==========
  interface IWalnutAdminSharedLocationDTO {
    country: string
    region: string
    city: string
  }

  // ========== Risk Info Types ==========
  interface IWalnutAdminDeviceRiskInfo {
    deviceId: string
    score: number
    factors: string[]
    level: IWalnutAdminConstRiskLevel
    evaluatedAt: number
    isNewDevice: boolean
    isBanned: boolean
    isLocked: boolean
    daysSinceCreated: number
  }

  interface IWalnutAdminRecordFailedLoginPayload {
    identifier?: string
    loginType: IWalnutAdminConstDecoratorLogAuthType
    deviceId: string
    ip: string
    reason: string
  }

  interface IWalnutAdminFailedLoginInfo extends IWalnutAdminRecordFailedLoginPayload {
    count: number
    lastFailedAt: number
  }

  interface IWalnutAdminIpBlacklistInfo {
    ip: string
    reason: string
    permanent: number
    bannedAt: number
    expiresAt?: number
  }

  interface IWalnutAdminIpLocationInfo extends IWalnutAdminSharedLocationDTO {
    ip: string
    latitude?: number
    longitude?: number
    isp?: string
    timezone?: string
  }

  interface IWalnutAdminLocationRiskInfo {
    ip: string
    location: IWalnutAdminIpLocationInfo
    score: number
    factors: string[]
    level: IWalnutAdminConstRiskLevel
    evaluatedAt: number
  }

  interface IWalnutAdminRateRiskCheckResult {
    hit: boolean
    current: number
    threshold: number
    windowMinutes: number
    type: 'ip' | 'device' | 'user'
    identifier: string
  }

  interface IWalnutAdminRateRiskInfo {
    ip: string
    deviceId?: string
    userId?: string
    ipCheckResult?: IWalnutAdminRateRiskCheckResult
    deviceCheckResult?: IWalnutAdminRateRiskCheckResult
    userCheckResult?: IWalnutAdminRateRiskCheckResult
  }

  interface IWalnutAdminUserRiskInfo {
    userId: string
    score: number
    factors: string[]
    level: IWalnutAdminConstRiskLevel
    evaluatedAt: number
    accountDisabled: boolean
    noRegistration: boolean
    noMfa: boolean
  }

  interface IWalnutAdminUserDeviceRiskInfo {
    userId: string
    deviceId: string
    score: number
    factors: string[]
    level: IWalnutAdminConstRiskLevel
    evaluatedAt: number
    isTrusted: boolean
    isLocked: boolean
    trustExpired: boolean
    lastActiveAt?: number
  }

  // ========== Risk Result Types ==========
  interface IWalnutAdminRiskEvaluationResult<T = Record<string, any>> {
    type: IWalnutAdminConstRiskType
    score: number
    level: IWalnutAdminConstRiskLevel
    factors: string[]
    evaluatedAt: number
    details?: T | null
  }

  interface IWalnutAdminPreAuthRiskResult {
    type: 'BEFORE_AUTH'
    ip: IWalnutAdminRiskEvaluationResult<IWalnutAdminIpBlacklistInfo>
    device: IWalnutAdminRiskEvaluationResult<IWalnutAdminDeviceRiskInfo>
    location: IWalnutAdminRiskEvaluationResult<IWalnutAdminLocationRiskInfo>
    rate: IWalnutAdminRiskEvaluationResult<IWalnutAdminRateRiskInfo>
    failedLogin: IWalnutAdminRiskEvaluationResult<IWalnutAdminFailedLoginInfo>
    score: number
    level: IWalnutAdminConstRiskLevel
  }

  interface IWalnutAdminPostAuthRiskResult {
    type: 'AFTER_AUTH'
    user: IWalnutAdminRiskEvaluationResult
    userDevice: IWalnutAdminRiskEvaluationResult
    score: number
    level: IWalnutAdminConstRiskLevel
  }

  interface IWalnutAdminComprehensiveRiskResult {
    type: 'COMPREHENSIVE'
    preAuth: IWalnutAdminPreAuthRiskResult
    postAuth?: IWalnutAdminPostAuthRiskResult
    overallScore: number
    overallLevel: IWalnutAdminConstRiskLevel
    allFactors: string[]
    recommendation: {
      shouldBlock: boolean
      shouldChallenge: boolean
      shouldLog: boolean
      reason: string
      criticalFactors?: string[]
    }
    evaluatedAt: number
  }

  interface IWalnutAdminRequestRiskContext {
    comprehensive: IWalnutAdminComprehensiveRiskResult
    timestamp: number
    evaluationDuration: number
  }

  interface IWalnutAdminChallengeParams {
    ip: string
    deviceId: string
    userId?: string
    location?: string
  }
}

export {}

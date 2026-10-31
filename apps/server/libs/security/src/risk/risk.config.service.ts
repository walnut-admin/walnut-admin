import { Injectable } from '@nestjs/common'

// ==================== Type Definitions ====================
// Note: Types are now defined globally in @walnut-server/types/walnut-admin/risk.d.ts

export const WalnutAdminConstRiskLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const

export const WalnutAdminConstRiskType = {
  IP: 'IP',
  DEVICE: 'DEVICE',
  USER: 'USER',
  USER_DEVICE: 'USER_DEVICE',
  FAILED_LOGIN: 'FAILED_LOGIN',
  LOCATION: 'LOCATION',
  RATE: 'RATE',
  BEFORE_AUTH: 'BEFORE_AUTH',
  AFTER_AUTH: 'AFTER_AUTH',
  COMPREHENSIVE: 'COMPREHENSIVE',
} as const

// ==================== Risk Factor Constants ====================

export const WalnutAdminConstRiskFactor = {
  // IP
  IP_BLACKLIST_PERMANENT: 'IP_BLACKLIST_PERMANENT',
  IP_BLACKLIST_TEMPORARY: 'IP_BLACKLIST_TEMPORARY',

  // DEVICE
  DEVICE_NEW: 'DEVICE_NEW',
  DEVICE_RECENT: 'DEVICE_RECENT',
  DEVICE_CURRENT_IP_BLACKLISTED: 'DEVICE_CURRENT_IP_BLACKLISTED',
  DEVICE_HISTORY_IP_BLACKLISTED: 'DEVICE_HISTORY_IP_BLACKLISTED',
  DEVICE_BANNED: 'DEVICE_BANNED',
  DEVICE_LOCKED: 'DEVICE_LOCKED',
  DEVICE_PRIVATE: 'DEVICE_PRIVATE',

  // USER
  USER_DISABLED: 'USER_DISABLED',
  USER_NO_PASSWORD: 'USER_NO_PASSWORD',
  USER_NO_MFA: 'USER_NO_MFA',

  // USER_DEVICE
  USER_DEVICE_LOCKED: 'USER_DEVICE_LOCKED',
  USER_DEVICE_UNTRUSTED: 'USER_DEVICE_UNTRUSTED',
  USER_DEVICE_TRUST_EXPIRED: 'USER_DEVICE_TRUST_EXPIRED',
  USER_DEVICE_INACTIVE: 'USER_DEVICE_INACTIVE',

  // LOCATION
  LOCATION_HIGH_RISK_COUNTRY: 'LOCATION_HIGH_RISK_COUNTRY',
  LOCATION_VPN_OR_PROXY: 'LOCATION_VPN_OR_PROXY',
  LOCATION_JUMP: 'LOCATION_JUMP',

  // FAILED_LOGIN & RATE
  FAILED_LOGINS: 'FAILED_LOGINS',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
} as const

// Note: IWalnutAdminConstRiskFactor type is defined globally in @walnut-server/types/walnut-admin/risk.d.ts

// ==================== Risk Factor Configuration (with full types) ====================

/**
 * Risk factor weights and property configuration
 */
export const RISK_FACTORS: Record<
  IWalnutAdminConstRiskFactor,
  {
    weight: number
    critical: boolean
    stage: IWalnutAdminRiskFactorStage
  }
> = {
  // IP factors
  [WalnutAdminConstRiskFactor.IP_BLACKLIST_PERMANENT]: {
    weight: 1.0,
    critical: false,
    stage: 'pre-auth',
  },
  [WalnutAdminConstRiskFactor.IP_BLACKLIST_TEMPORARY]: {
    weight: 0.8,
    critical: false,
    stage: 'pre-auth',
  },

  // Device factors
  [WalnutAdminConstRiskFactor.DEVICE_NEW]: {
    weight: 0.3,
    critical: true,
    stage: 'pre-auth',
  },
  [WalnutAdminConstRiskFactor.DEVICE_RECENT]: {
    weight: 0.15,
    critical: true,
    stage: 'pre-auth',
  },
  [WalnutAdminConstRiskFactor.DEVICE_CURRENT_IP_BLACKLISTED]: {
    weight: 0.3,
    critical: false,
    stage: 'pre-auth',
  },
  [WalnutAdminConstRiskFactor.DEVICE_HISTORY_IP_BLACKLISTED]: {
    weight: 0.2,
    critical: false,
    stage: 'pre-auth',
  },
  [WalnutAdminConstRiskFactor.DEVICE_BANNED]: {
    weight: 1.0,
    critical: false,
    stage: 'pre-auth',
  },
  [WalnutAdminConstRiskFactor.DEVICE_LOCKED]: {
    weight: 0.5,
    critical: false,
    stage: 'pre-auth',
  },
  [WalnutAdminConstRiskFactor.DEVICE_PRIVATE]: {
    weight: 1.0,
    critical: true,
    stage: 'pre-auth',
  },

  // User factors
  [WalnutAdminConstRiskFactor.USER_DISABLED]: {
    weight: 0.5,
    critical: false,
    stage: 'post-auth',
  },
  [WalnutAdminConstRiskFactor.USER_NO_PASSWORD]: {
    weight: 0.1,
    critical: false,
    stage: 'post-auth',
  },
  [WalnutAdminConstRiskFactor.USER_NO_MFA]: {
    weight: 0.1,
    critical: false,
    stage: 'post-auth',
  },

  // User-Device factors
  [WalnutAdminConstRiskFactor.USER_DEVICE_UNTRUSTED]: {
    weight: 0.6,
    critical: true,
    stage: 'post-auth',
  },
  [WalnutAdminConstRiskFactor.USER_DEVICE_TRUST_EXPIRED]: {
    weight: 0.4,
    critical: true,
    stage: 'post-auth',
  },
  [WalnutAdminConstRiskFactor.USER_DEVICE_LOCKED]: {
    weight: 0.4,
    critical: true,
    stage: 'post-auth',
  },
  [WalnutAdminConstRiskFactor.USER_DEVICE_INACTIVE]: {
    weight: 0.2,
    critical: false,
    stage: 'post-auth',
  },

  // Location factors
  [WalnutAdminConstRiskFactor.LOCATION_HIGH_RISK_COUNTRY]: {
    weight: 0.6,
    critical: true,
    stage: 'pre-auth',
  },
  [WalnutAdminConstRiskFactor.LOCATION_VPN_OR_PROXY]: {
    weight: 0.4,
    critical: true,
    stage: 'pre-auth',
  },
  [WalnutAdminConstRiskFactor.LOCATION_JUMP]: {
    weight: 0.3,
    critical: true,
    stage: 'pre-auth',
  },

  // Failed login and rate factors
  [WalnutAdminConstRiskFactor.FAILED_LOGINS]: {
    weight: 0.5,
    critical: false,
    stage: 'pre-auth',
  },
  [WalnutAdminConstRiskFactor.RATE_LIMIT_EXCEEDED]: {
    weight: 0.3,
    critical: false,
    stage: 'both',
  },
} as const

// Derived type
type RiskFactorKey = keyof typeof RISK_FACTORS
// Note: Uses global IWalnutAdminConstRiskFactor type

// ==================== Pre-computed Query Sets ====================

const CRITICAL_FACTORS = new Set(
  Object.entries(RISK_FACTORS)
    .filter(([_, config]) => config.critical)
    .map(([factor]) => factor),
)

const PRE_AUTH_CRITICAL_FACTORS = new Set(
  Object.entries(RISK_FACTORS)
    .filter(([_, config]) =>
      config.critical && (config.stage === 'pre-auth' || config.stage === 'both'),
    )
    .map(([factor]) => factor),
)

const POST_AUTH_CRITICAL_FACTORS = new Set(
  Object.entries(RISK_FACTORS)
    .filter(([_, config]) =>
      config.critical && (config.stage === 'post-auth' || config.stage === 'both'),
    )
    .map(([factor]) => factor),
)

// ==================== Helper Functions ====================

export function getRiskLevel(
  score: number,
  thresholds = {
    CRITICAL: 0.8,
    HIGH: 0.6,
    MEDIUM: 0.3,
    LOW: 0.0,
  },
): IWalnutAdminConstRiskLevel {
  if (score >= thresholds.CRITICAL)
    return WalnutAdminConstRiskLevel.CRITICAL
  if (score >= thresholds.HIGH)
    return WalnutAdminConstRiskLevel.HIGH
  if (score >= thresholds.MEDIUM)
    return WalnutAdminConstRiskLevel.MEDIUM
  return WalnutAdminConstRiskLevel.LOW
}

export function isHighRisk(score: number, threshold = 0.6): boolean {
  return score >= threshold
}

export function isCriticalRisk(score: number, threshold = 0.8): boolean {
  return score >= threshold
}

export function calcScoreAndLevel(score: number): { score: number, level: IWalnutAdminConstRiskLevel } {
  const finalScore = Math.min(score, 1.0)
  const level = getRiskLevel(finalScore)
  return { score: finalScore, level }
}

// ==================== Configuration Service ====================

@Injectable()
export class SecurityRiskConfigService {
  /**
   * Redis Key prefixes
   */
  readonly redis = {
    // 设备相关
    deviceInfo: 'risk:device',

    // 用户相关
    userInfo: 'risk:user',

    // 用户-设备相关
    userDeviceInfo: 'risk:user_device',

    // 失败登录相关
    failedLoginInfo: 'risk:failed_login',

    // 位置相关
    location: 'risk:location',

    // 频率相关
    ratePrefix: 'risk:rate',

    // challenge 相关
    challenge: 'risk:challenge',
  } as const

  /**
   * Cache TTL (seconds)
   */
  readonly ttl = {
    ipTempBan: 1800, // 30min
    deviceInfo: 600, // 10min
    userInfo: 600, // 10min
    userDeviceInfo: 600, // 10min
    failedLogin: 900, // 15min
    location: 86400, // 24h
    rateBucket: 600, // 10min
    challenge: 86400, // 24h
  } as const

  /**
   * Module weights (sum to 1.0 for each evaluation stage)
   */
  readonly moduleWeights = {
    IP: 0.25,
    DEVICE: 0.25,
    FAILED_LOGIN: 0.2,
    LOCATION: 0.15,
    RATE: 0.15,
    USER: 0.2,
    USER_DEVICE: 0.3,
  } as const

  /**
   * Threshold configuration
   */
  readonly thresholds = {
    device: {
      newDeviceDays: 1,
      recentDeviceDays: 7,
    },
    userDevice: {
      inactiveDays: 30,
    },
    failedLogin: {
      threshold: 5,
    },
    rate: {
      ip1m: 120,
      ip5m: 400,
      device1m: 120,
      user1m: 120,
    },
  } as const

  /**
   * Risk level thresholds
   */
  readonly riskLevel = {
    critical: 0.8,
    high: 0.6,
    medium: 0.3,
    low: 0.0,
  } as const

  /**
   * High-risk countries/regions
   */
  readonly highRiskCountries = new Set(['UNKNOWN'])

  /**
   * VPN/proxy detection keywords
   */
  readonly vpnKeywords = ['vpn', 'proxy', 'hosting', 'cloud', 'virtual', 'datacenter']

  /**
   * Risk factor configuration (exposed directly with full TypeScript types)
   */
  readonly factors = RISK_FACTORS

  // ==================== Simplified Query Methods ====================

  /**
   * Get factor weight (with type hints)
   */
  getWeight(factor: RiskFactorKey): number {
    return RISK_FACTORS[factor].weight
  }

  /**
   * Check if a factor is critical
   */
  isCritical(factor: string): boolean {
    return CRITICAL_FACTORS.has(factor)
  }

  /**
   * Get all critical factors
   */
  getCriticalFactors(): Set<string> {
    return new Set(CRITICAL_FACTORS)
  }

  /**
   * Get pre-auth critical factors
   */
  getPreAuthCriticalFactors(): Set<string> {
    return new Set(PRE_AUTH_CRITICAL_FACTORS)
  }

  /**
   * Get post-auth critical factors
   */
  getPostAuthCriticalFactors(): Set<string> {
    return new Set(POST_AUTH_CRITICAL_FACTORS)
  }

  // ==================== Runtime Updates (optional) ====================

  addHighRiskCountry(country: string) {
    this.highRiskCountries.add(country)
  }

  removeHighRiskCountry(country: string) {
    this.highRiskCountries.delete(country)
  }
}

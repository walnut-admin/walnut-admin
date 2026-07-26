import type { IWalnutAdminConstSecurityLevel, IWalnutAdminConstSecuritySensitiveType, IWalnutAdminConstVerifyMethod, IWalnutAdminConstVerifyStrength } from './sensitive.const'
import type { ISecurityLevelStrategy } from './sensitive.type'
import {
  WalnutAdminConstSecurityLevel,
  WalnutAdminConstSecuritySensitiveType,
  WalnutAdminConstVerifyMethod,
  WalnutAdminConstVerifyStrength,
} from './sensitive.const'

/**
 * Verification method strength mapping
 */
export const VERIFY_METHOD_STRENGTH: Record<IWalnutAdminConstVerifyMethod, IWalnutAdminConstVerifyStrength> = {
  [WalnutAdminConstVerifyMethod.EMAIL]: WalnutAdminConstVerifyStrength.LOW,
  [WalnutAdminConstVerifyMethod.PASSWORD]: WalnutAdminConstVerifyStrength.MEDIUM,
  [WalnutAdminConstVerifyMethod.SMS]: WalnutAdminConstVerifyStrength.MEDIUM,
  [WalnutAdminConstVerifyMethod.MFA]: WalnutAdminConstVerifyStrength.HIGH,
}

/**
 * Security level strategies configuration
 */
export const SECURITY_LEVEL_STRATEGIES: Record<
  IWalnutAdminConstSecurityLevel,
  ISecurityLevelStrategy & {
    operations?: Partial<Record<IWalnutAdminConstSecuritySensitiveType, Partial<ISecurityLevelStrategy>>>
  }
> = {
  [WalnutAdminConstSecurityLevel.BASIC]: {
    supportedMethods: [
      WalnutAdminConstVerifyMethod.PASSWORD,
      WalnutAdminConstVerifyMethod.SMS,
      WalnutAdminConstVerifyMethod.EMAIL,
    ],
    minStrength: WalnutAdminConstVerifyStrength.LOW,
  },

  [WalnutAdminConstSecurityLevel.ACCOUNT_CRITICAL]: {
    supportedMethods: [
      WalnutAdminConstVerifyMethod.PASSWORD,
      WalnutAdminConstVerifyMethod.SMS,
      WalnutAdminConstVerifyMethod.MFA,
    ],
    minStrength: WalnutAdminConstVerifyStrength.MEDIUM,

    // Operation-specific overrides
    operations: {
      [WalnutAdminConstSecuritySensitiveType.EMAIL_BIND]: {
        supportedMethods: [WalnutAdminConstVerifyMethod.PASSWORD],
      },
      [WalnutAdminConstSecuritySensitiveType.EMAIL_STATUS_TOGGLE]: {
        supportedMethods: [WalnutAdminConstVerifyMethod.EMAIL],
      },
      [WalnutAdminConstSecuritySensitiveType.PHONE_BIND]: {
        supportedMethods: [WalnutAdminConstVerifyMethod.PASSWORD],
      },
      [WalnutAdminConstSecuritySensitiveType.PASSWORD_CHANGE]: {
        supportedMethods: [
          WalnutAdminConstVerifyMethod.SMS,
          WalnutAdminConstVerifyMethod.MFA,
        ],
      },
    },
  },

  [WalnutAdminConstSecurityLevel.FINANCIAL]: {
    supportedMethods: [
      WalnutAdminConstVerifyMethod.SMS,
      WalnutAdminConstVerifyMethod.MFA,
    ],
    minStrength: WalnutAdminConstVerifyStrength.HIGH,
  },

  [WalnutAdminConstSecurityLevel.ADMIN_CRITICAL]: {
    supportedMethods: [
      WalnutAdminConstVerifyMethod.PASSWORD,
      WalnutAdminConstVerifyMethod.SMS,
      WalnutAdminConstVerifyMethod.MFA,
    ],
    minStrength: WalnutAdminConstVerifyStrength.MEDIUM,
  },
}

/**
 * Get strategy for specific operation
 */
export function getOperationStrategy(
  level: IWalnutAdminConstSecurityLevel,
  operationType?: IWalnutAdminConstSecuritySensitiveType,
): ISecurityLevelStrategy {
  const levelStrategy = SECURITY_LEVEL_STRATEGIES[level]

  if (!operationType || !levelStrategy.operations?.[operationType]) {
    return {
      supportedMethods: levelStrategy.supportedMethods,
      minStrength: levelStrategy.minStrength,
    }
  }

  const opOverride = levelStrategy.operations[operationType]

  return {
    supportedMethods: opOverride.supportedMethods ?? levelStrategy.supportedMethods,
    minStrength: opOverride.minStrength ?? levelStrategy.minStrength,
  }
}

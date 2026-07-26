import type {
  IWalnutAdminConstSecurityLevel,
  IWalnutAdminConstSecuritySensitiveType,
  IWalnutAdminConstVerifyMethod,
  IWalnutAdminConstVerifyStrength,
} from './sensitive.const'

/**
 * Decorator options for sensitive operation guard
 */
export interface IWalnutAdminGuardRequireSensitiveOptions {
  level: IWalnutAdminConstSecurityLevel
  type: IWalnutAdminConstSecuritySensitiveType
  allowChoose?: boolean // Whether user can choose verification method
}

/**
 * Redis stored permission data
 */
export interface ISensitivePermissionData {
  operationType: IWalnutAdminConstSecuritySensitiveType
  verifyMethod: IWalnutAdminConstVerifyMethod
  grantedAt: number
  expiresAt: number
}

/**
 * Security level verification strategy
 */
export interface ISecurityLevelStrategy {
  supportedMethods: IWalnutAdminConstVerifyMethod[]
  minStrength: IWalnutAdminConstVerifyStrength
}

/**
 * Operation type specific strategy (override level strategy)
 */
export interface IOperationTypeStrategy extends ISecurityLevelStrategy {
  operationType: IWalnutAdminConstSecuritySensitiveType
}

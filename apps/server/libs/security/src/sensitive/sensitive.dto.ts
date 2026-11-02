import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { IWalnutAdminConstSecurityLevel, IWalnutAdminConstSecuritySensitiveType, IWalnutAdminConstVerifyMethod, WalnutAdminConstSecurityLevel, WalnutAdminConstSecuritySensitiveType, WalnutAdminConstVerifyMethod } from './sensitive.const'

/**
 * 敏感操作检查的 wire 响应面。
 *
 * 批 6-A（F-28 同一口径）：下面三个字段随 `needsVerification` 分支出现 ——
 * 已授权时只有 `remainingSeconds`，需要验证时有 `availableMethods` /
 * `preferredMethod`，缺席的那个分支里键根本不出现。原先用「`?` 类型标记」表达，
 * 等于给「可空」造第二个真源；现在按本文件 F-28 的既有写法收口：类型写 `| null`，
 * 可选性由字段装饰器的 `default: null` 表达。响应面不做入参校验，wire 零变化。
 */
export class SecuritySensitiveCheckResponseDTO {
  constructor(partial?: Partial<SecuritySensitiveCheckResponseDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'needs verification',
    },
  })
  needsVerification: boolean

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'remaining seconds',
    },
  })
  remainingSeconds: number | null

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstVerifyMethod, {
    default: null,
    isArray: true,
    swaggerOptions: {
      title: 'available methods',
    },
  })
  availableMethods: IWalnutAdminConstVerifyMethod[] | null

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstVerifyMethod, {
    default: null,
    swaggerOptions: {
      title: 'preferred method',
    },
  })
  preferredMethod: IWalnutAdminConstVerifyMethod | null
}

export class SecuritySensitiveVerifyRequestDTO {
  constructor(partial?: Partial<SecuritySensitiveVerifyRequestDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSecurityLevel, {
    swaggerOptions: {
      title: 'security level',
    },
  })
  level: IWalnutAdminConstSecurityLevel

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstVerifyMethod, {
    swaggerOptions: {
      title: 'verify method',
    },
  })
  method: IWalnutAdminConstVerifyMethod

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'credential',
    },
  })
  credential: string

  // F-28：字段可选性只由装饰器的 `default` 表达（AGENTS 硬规矩：DTO 不写 ? 与 !）——
  // 原先写 `operationType?` 且无 default，等于给「可空」造了第二个真源，调用侧只能靠
  // 非空断言（sensitive.controller 的 `dto.operationType!`）把它压回非空。
  // 语义：缺省 = 按 level 的整档策略（getOperationStrategy 的 operationType 参数可选）。
  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSecuritySensitiveType, {
    default: null,
    swaggerOptions: {
      title: 'operation type',
      description: 'sensitive operation type; omitted => use the level strategy',
    },
  })
  operationType: IWalnutAdminConstSecuritySensitiveType | null
}

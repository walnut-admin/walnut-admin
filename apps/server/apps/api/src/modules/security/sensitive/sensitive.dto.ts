import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { IWalnutAdminConstSecurityLevel, IWalnutAdminConstSecuritySensitiveType, IWalnutAdminConstVerifyMethod, WalnutAdminConstSecurityLevel, WalnutAdminConstSecuritySensitiveType, WalnutAdminConstVerifyMethod } from './sensitive.const'

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
    swaggerOptions: {
      title: 'remaining seconds',
    },
  })
  remainingSeconds?: number

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstVerifyMethod, {
    isArray: true,
    swaggerOptions: {
      title: 'available methods',
    },
  })
  availableMethods?: IWalnutAdminConstVerifyMethod[]

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstVerifyMethod, {
    swaggerOptions: {
      title: 'preferred method',
    },
  })
  preferredMethod?: IWalnutAdminConstVerifyMethod
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

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSecuritySensitiveType, {
    swaggerOptions: {
      title: 'operation type',
    },
  })
  operationType?: IWalnutAdminConstSecuritySensitiveType
}

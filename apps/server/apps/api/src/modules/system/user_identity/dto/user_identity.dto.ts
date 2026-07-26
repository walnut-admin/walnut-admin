import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { IdentitySendDTO, IdentityVerifyDTO } from '@/modules/auth/dto/identity.dto'
import { SysUserIdentityModel } from '../schema/user_identity.schema'

// Base DTO - extends Model with all fields
export class SysUserIdentityDTO extends SysUserIdentityModel {
  constructor(partial: Partial<SysUserIdentityDTO>) {
    super()
    Object.assign(this, partial)
  }
}

// DTO for creating identity
export class SysUserIdentityCreateDTO extends RealPickType(SysUserIdentityDTO, [
  'userId',
  'type',
  'purpose',
  'value',
  'valueHash',
  'maskedValue',
  'verified',
  'isPrimary',
  'status',
  'metadata',
] as const) {
  constructor(partial: Partial<SysUserIdentityCreateDTO>) {
    super()
    Object.assign(this, partial)
  }
}

// DTO for updating identity - just partial of create
export class SysUserIdentityUpdateDTO extends RealPartialType(SysUserIdentityCreateDTO) {
  constructor(partial: Partial<SysUserIdentityUpdateDTO>) {
    super()
    Object.assign(this, partial)
  }
}

// DTO for list request
export class SysUserIdentityListDTO {}

// DTO for identity status item
class SysUserIdentityStatusOTPItemDTO extends RealPickType(SysUserIdentityDTO, ['maskedValue', 'verified', 'status'] as const) {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      description: 'Whether the identity is bound',
    },
  })
  bound: boolean
}

class SysUserIdentityStatusPasswordDTO {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      description: 'Whether the password is set',
    },
  })
  set: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      description: 'Last changed time of password',
    },
  })
  lastChanged: Date
}

// DTO for user identity status response (like Figure 1)
export class SysUserIdentityStatusResponseDTO {
  constructor(partial: Partial<SysUserIdentityStatusResponseDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysUserIdentityStatusPasswordDTO, {
    swaggerOptions: {
      description: 'Status for password identity',
    },
  })
  password: SysUserIdentityStatusPasswordDTO

  @WalnutAdminDecoratorFieldObject(SysUserIdentityStatusOTPItemDTO, {
    swaggerOptions: {
      description: 'Status for phone number identities',
    },
  })
  phoneNumber: SysUserIdentityStatusOTPItemDTO

  @WalnutAdminDecoratorFieldObject(SysUserIdentityStatusOTPItemDTO, {
    swaggerOptions: {
      description: 'Status for email address identities',
    },
  })
  emailAddress: SysUserIdentityStatusOTPItemDTO
}

// DTO for check request (step 1: validate and send verify code)
export class SysUserIdentityCheckRequestDTO extends IdentitySendDTO {
  constructor(partial: Partial<SysUserIdentityCheckRequestDTO>) {
    super()
    Object.assign(this, partial)
  }
}

// DTO for bind request (step 2: verify code and bind)
export class SysUserIdentityBindRequestDTO extends IdentityVerifyDTO {
  constructor(partial: Partial<SysUserIdentityBindRequestDTO>) {
    super()
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: { description: 'whether to also set as security identity' },
  })
  setAsSecurity: boolean
}

export class SysUserIdentityVerifyRequestDTO extends RealPickType(IdentityVerifyDTO, ['verifyCode'] as const) {}

// DTO for updating status (enable/disable)
export class SysUserIdentityStatusRequestDTO extends RealPickType(SysUserIdentityDTO, ['status'] as const) {}

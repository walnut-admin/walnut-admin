import type { Recordable } from 'easy-fns-ts'

import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { WalnutAdminDecoratorTransformDefault } from '@walnut-server/decorators/transformer'
import { WalnutAdminDecoratorValidatorObject } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { WalnutAdminCommonBasicModel } from '../../shared/base.model'
import { IWalnutAdminConstSysUserIdentityPurpose, IWalnutAdminConstSysUserIdentityType, WalnutAdminConstSysUserIdentityPurpose, WalnutAdminConstSysUserIdentityType } from '../identity.const'
import { IdentitySendDTO, IdentityVerifyDTO } from './identity.dto'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/user_identity.schema.ts 的
// SysUserIdentityModel 改名 SysUserIdentityDTOBase），装饰器与字段本体零改动

export class SysUserIdentityDTOBase extends WalnutAdminCommonBasicModel {
  @Expose()
  userId: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserIdentityType, {
    swaggerOptions: {
      title: 'identity type',
      description: 'phoneNumber / emailAddress / idCard / password',
    },
  })
  type: IWalnutAdminConstSysUserIdentityType

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserIdentityPurpose, {
    swaggerOptions: {
      title: 'identity purpose',
      description: 'login => for sign in; security => for verification and notification',
    },
  })
  purpose: IWalnutAdminConstSysUserIdentityPurpose

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'encrypted value',
      description: 'AES-256-GCM encrypted value (phone/email/idCard/password)',
    },
  })
  value: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'value hash',
      description: 'HMAC-SHA256 hash for quick lookup without decryption',
    },
  })
  valueHash: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'masked value',
      description: 'masked value for display (e.g., +86****17304)',
    },
  })
  maskedValue: string | null

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'verified',
      description: 'whether the identity has been verified',
    },
  })
  verified: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'verified at',
      description: 'verification timestamp',
    },
  })
  verifiedAt: Date

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'is primary',
      description: 'whether this is the primary identity of this type',
    },
  })
  isPrimary: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'status',
      description: 'enable/disable status',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      title: 'metadata',
      description: 'extended metadata JSON string for future use (e.g., real-name auth info)',
    },
  })
  metadata: Recordable
}

// Base DTO - extends base with all fields
export class SysUserIdentityDTO extends SysUserIdentityDTOBase {
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
// P1-6① 修复（2026-10-28）：空类在全局 forbidUnknownValues 下恒被判定为 "unknown value"
// （40099），端点经 HTTP 不可用。这里用一个**不约束任何键**的校验元数据占位，列表读腿
// 本来也不消费任何过滤字段（userId 由 token 注入）。
// F-38：占位改用项目的 object 校验器（内部即 class-validator 的 Allow），不裸挂
// class-validator —— 它同时只补 Allow、不产生 swagger 字段，文档面与之前完全一致。
export class SysUserIdentityListDTO {
  @WalnutAdminDecoratorValidatorObject({ required: false })
  readonly _marker: never
}

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

  // P1-6② 修复：缺省视为 false（swagger default 不参与校验，不物化时缺字段 40099）。
  // F-38：不再裸挂 class-validator 的 IsOptional —— 用项目 transformer 把上面装饰器里声明的
  // default 真正物化（缺省 / 显式 null → false），校验因此天然放行，且默认值只有一个真源。
  @WalnutAdminDecoratorTransformDefault(false, false, { toClassOnly: true })
  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: { description: 'whether to also set as security identity' },
  })
  setAsSecurity: boolean
}

export class SysUserIdentityVerifyRequestDTO extends RealPickType(IdentityVerifyDTO, ['verifyCode'] as const) {}

// DTO for updating status (enable/disable)
export class SysUserIdentityStatusRequestDTO extends RealPickType(SysUserIdentityDTO, ['status'] as const) {}

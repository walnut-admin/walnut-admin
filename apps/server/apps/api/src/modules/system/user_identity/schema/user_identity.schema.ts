import type { Recordable, ValueOf } from 'easy-fns-ts'

import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { Expose } from 'class-transformer'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

// Identity type constants
export const WalnutAdminConstSysUserIdentityType = {
  PHONE_NUMBER: 'phoneNumber',
  EMAIL_ADDRESS: 'emailAddress',
  ID_CARD: 'idCard',
  PASSWORD: 'password',
} as const

export type IWalnutAdminConstSysUserIdentityType = ValueOf<typeof WalnutAdminConstSysUserIdentityType>

// Identity purpose constants
export const WalnutAdminConstSysUserIdentityPurpose = {
  LOGIN: 'login',
  SECURITY: 'security',
} as const

export type IWalnutAdminConstSysUserIdentityPurpose = ValueOf<typeof WalnutAdminConstSysUserIdentityPurpose>

export class SysUserIdentityModel extends WalnutAdminCommonBasicModel {
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

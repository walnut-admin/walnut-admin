import type { Recordable, ValueOf } from 'easy-fns-ts'
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'

import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { HydratedDocument, Model, Types } from 'mongoose'
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

export type ISysUserIdentityDocument = HydratedDocument<
  SysUserIdentityModel & ISysUserIdentityMethods
>

export type ISysUserIdentityModel = Model<ISysUserIdentityDocument>
  & ISysUserIdentityStatics

export interface ISysUserIdentityMethods {}

export interface ISysUserIdentityStatics {}

@Schema({
  collection: WalnutDBCollectionName.USER_IDENTITY,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysUserIdentityModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'user id',
      description: 'associated user id',
    },
  })
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_USER,
    required: true,
    index: true,
  })
  userId: Types.ObjectId | string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserIdentityType, {
    swaggerOptions: {
      title: 'identity type',
      description: 'phoneNumber / emailAddress / idCard / password',
    },
  })
  @Prop({
    type: String,
    enum: [...Object.values(WalnutAdminConstSysUserIdentityType)],
    required: true,
  })
  type: IWalnutAdminConstSysUserIdentityType

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserIdentityPurpose, {
    swaggerOptions: {
      title: 'identity purpose',
      description: 'login => for sign in; security => for verification and notification',
    },
  })
  @Prop({
    type: String,
    enum: [...Object.values(WalnutAdminConstSysUserIdentityPurpose)],
    required: true,
  })
  purpose: IWalnutAdminConstSysUserIdentityPurpose

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'encrypted value',
      description: 'AES-256-GCM encrypted value (phone/email/idCard/password)',
    },
  })
  @Prop({ type: String, required: true, select: false })
  value: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'value hash',
      description: 'HMAC-SHA256 hash for quick lookup without decryption',
    },
  })
  @Prop({ type: String, required: true, index: true })
  valueHash: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'masked value',
      description: 'masked value for display (e.g., +86****17304)',
    },
  })
  @Prop({ type: String, required: true })
  maskedValue: string | null

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'verified',
      description: 'whether the identity has been verified',
    },
  })
  @Prop({ type: Boolean, default: false })
  verified: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'verified at',
      description: 'verification timestamp',
    },
  })
  @Prop({ type: Date, default: null })
  verifiedAt: Date

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'is primary',
      description: 'whether this is the primary identity of this type',
    },
  })
  @Prop({ type: Boolean, default: true })
  isPrimary: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'status',
      description: 'enable/disable status',
    },
  })
  @Prop({ type: Boolean, default: true })
  status: boolean

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      title: 'metadata',
      description: 'extended metadata JSON string for future use (e.g., real-name auth info)',
    },
  })
  @Prop({ type: Object, default: {} })
  metadata: Recordable
}

export const SysUserIdentitySchema = SchemaFactory.createForClass(SysUserIdentityModel)

// Compound unique index: one user can only have one identity of each type and purpose
SysUserIdentitySchema.index(
  { userId: 1, type: 1, purpose: 1 },
  { unique: true },
)

// Index for checking value existence by hash
SysUserIdentitySchema.index({ type: 1, valueHash: 1 })

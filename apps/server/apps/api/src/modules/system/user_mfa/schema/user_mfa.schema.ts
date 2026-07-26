import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { ValueOf } from 'easy-fns-ts'
import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export const WalnutAdminConstSysUserMfaType = [
  'totp',
  'webauthn',
] as const

export type IWalnutAdminConstSysUserMfaType = ValueOf<
  typeof WalnutAdminConstSysUserMfaType
>

export const WalnutAdminConstSysUserMfaWebauthnTransport = [
  'usb',
  'ble',
  'nfc',
  'internal',
  'hybrid',
] as const

export type IWalnutAdminConstSysUserMfaWebauthnTransport = ValueOf<
  typeof WalnutAdminConstSysUserMfaWebauthnTransport
>

export type ISysUserMfaDocument = HydratedDocument<
  SysUserMfaModel & ISysUserMfaMethods
>

export type ISysUserMfaModel = Model<ISysUserMfaDocument>
  & ISysUserMfaStatics

export interface ISysUserMfaMethods {}

export interface ISysUserMfaStatics {}

@Schema({
  collection: WalnutDBCollectionName.USER_MFA,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysUserMfaModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'user id',
    },
  })
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_USER,
    required: true,
    index: true,
  })
  userId: Types.ObjectId | string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserMfaType, {
    swaggerOptions: {
      title: 'mfa device type',
    },
  })
  @Prop({ type: String, required: true })
  type: IWalnutAdminConstSysUserMfaType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device id',
    },
  })
  @Prop({ type: String, required: true, ref: WalnutDBModelName.SYS_DEVICE })
  deviceId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'mfa device name',
    },
  })
  @Prop({ type: String, required: true })
  name: string

  // TOTP专用
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'totp secret ciphertext',
    },
  })
  @Prop({ type: String, default: null, select: false })
  totpSecretCiphertext: string

  // WebAuthn专用
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'webauthn credential id',
    },
  })
  @Prop({ type: String, default: null })
  webauthnCredentialId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'webauthn public key',
    },
  })
  @Prop({ type: String, default: null, select: false })
  webauthnPublicKey: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'webauthn counter',
    },
  })
  @Prop({ type: Number, default: 0 })
  webauthnCounter: number

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserMfaWebauthnTransport, {
    isArray: true,
    swaggerOptions: {
      title: 'webauthn transports',
    },
  })
  @Prop({ type: [String], default: [] })
  webauthnTransports: IWalnutAdminConstSysUserMfaWebauthnTransport[]

  // SMS专用
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'phone number ciphertext',
    },
  })
  @Prop({ type: String, default: null, select: false })
  phoneNumberCiphertext: string

  // 备用码专�?
  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'backup codes ciphertext',
    },
  })
  @Prop({ type: [String], default: [], select: false })
  backupCodesCiphertext: string[]

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'status',
    },
  })
  @Prop({ type: Boolean, default: true })
  status: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'last used at',
    },
  })
  @Prop({ type: Date, default: null })
  lastUsedAt: Date
}

export const SysUserMfaSchema
  = SchemaFactory.createForClass(SysUserMfaModel)

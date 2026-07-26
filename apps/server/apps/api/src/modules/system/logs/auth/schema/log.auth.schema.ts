import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { IWalnutAdminConstDecoratorLogAuthType, WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'

import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { RealPickType } from '@walnut-server/utils/dto'
import { HydratedDocument, Model, Types } from 'mongoose'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { addVirtualDeviceThroughDeviceId, IVirtualDevice } from '@/common/model/virtual/device'

export type ISysLogAuthDocument = HydratedDocument<
  SysLogAuthModel & ISysLogAuthMethods & IVirtualDevice
>

export type ISysLogAuthModel = Model<ISysLogAuthDocument> & ISysLogAuthStatics

interface ISysLogAuthMethods { }

interface ISysLogAuthStatics { }

@Schema({
  collection: WalnutDBCollectionName.LOG_AUTH,
  versionKey: false,
  timestamps: {
    createdAt: 'authenticatedAt',
    updatedAt: false,
  },
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysLogAuthModel extends RealPickType(WalnutAdminCommonBasicModel, ['_id'] as const) {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'ip address when auth',
    },
    validateOptions: {
      ip: true,
    },
  })
  @Prop({ type: String, default: null })
  ip: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'location when auth',
    },
  })
  @Prop({ type: String, default: null })
  location: string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'operating system when auth',
    },
  })
  @Prop({ type: String, default: null })
  os: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'browser when auth',
    },
  })
  @Prop({ type: String, default: null })
  browser: string

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'user id when auth',
    },
  })
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_USER,
  })
  userId: Types.ObjectId | string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'user name when auth',
    },
  })
  @Prop({ type: String, default: null })
  userName: string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'identifier when auth, e.g. email, phone number',
    },
  })
  @Prop({ type: String, default: null })
  identifier: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'auth success or not',
    },
  })
  @Prop({ type: Boolean, default: false })
  success: boolean

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'messages returned when auth',
    },
  })
  @Prop({ type: String, default: null })
  msg: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogAuthType, {
    default: null,
    swaggerOptions: {
      title: 'auth type',
      example: WalnutAdminConstDecoratorLogAuthType.OPAQUE,
    },
  })
  @Prop({
    type: () => WalnutAdminConstDecoratorLogAuthType,
    enum: [...Object.values(WalnutAdminConstDecoratorLogAuthType)],
    default: null,
  })
  type: IWalnutAdminConstDecoratorLogAuthType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'authenticate device id' },
  })
  @Prop({
    type: String,
    ref: WalnutDBModelName.SYS_DEVICE,
    required: true,
  })
  deviceId: string

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'authenticatedAt, also known as createdAt',
      required: false,
    },
  })
  @Prop({ type: Date })
  authenticatedAt?: Date
}

export const SysLogAuthSchema = SchemaFactory.createForClass(SysLogAuthModel)

// Virtual
addVirtualDeviceThroughDeviceId(SysLogAuthSchema)

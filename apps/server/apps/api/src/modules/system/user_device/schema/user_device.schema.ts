import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'

import {

  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { IsOptional } from 'class-validator'

import { ValueOf } from 'easy-fns-ts'
import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { addVirtualDeviceThroughDeviceId, IVirtualDevice } from '@/common/model/virtual/device'
import { addVirtualUserThroughUserId, IVirtualUser } from '@/common/model/virtual/user'

export type ISysUserDeviceDocument = HydratedDocument<
  SysUserDeviceModel & ISysUserDeviceMethods & IVirtualDevice & IVirtualUser
>

export type ISysUserDeviceModel = Model<ISysUserDeviceDocument>
  & ISysUserDeviceStatics

interface ISysUserDeviceMethods { }

interface ISysUserDeviceStatics { }

export const DeviceLinkConst = {
  USER: 'user',
  ADMIN: 'admin',
  SYSTEM: 'system',
} as const

type IDeviceLinkConst = ValueOf<typeof DeviceLinkConst>

@Schema({
  collection: WalnutDBCollectionName.USER_DEVICE,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysUserDeviceModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'device name, user can change this freely',
    },
  })
  @Prop({ type: String, default: null })
  deviceName: string

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'user id',
    },
  })
  @Prop({ type: Types.ObjectId, required: true, ref: WalnutDBModelName.SYS_USER })
  userId: Types.ObjectId

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device id',
    },
  })
  @Prop({ type: String, required: true, ref: WalnutDBModelName.SYS_DEVICE })
  deviceId: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'user/device link or not',
    },
  })
  @Prop({ type: Boolean, default: false })
  link: boolean

  @WalnutAdminDecoratorFieldEnum(() => DeviceLinkConst, {
    default: DeviceLinkConst.SYSTEM,
    swaggerOptions: {
      title: 'link type, user, admin, system',
      example: DeviceLinkConst.SYSTEM,
    },
  })
  @Prop({
    type: () => DeviceLinkConst,
    enum: [...Object.values(DeviceLinkConst)],
    default: DeviceLinkConst.SYSTEM,
  })
  linkType: IDeviceLinkConst

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'locked?',
    },
  })
  @Prop({ type: Boolean, default: false })
  locked: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'updatedAt, used as `lastActiveAt`',
      required: false,
    },
  })
  @IsOptional({})
  @Prop({ type: Date })
  lastActiveAt: Date

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'trusted?',
    },
  })
  @Prop({ type: Boolean, default: false })
  trusted: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'trusted expired at',
      required: false,
    },
  })
  @IsOptional({})
  @Prop({ type: Date })
  trustedExpiredAt: Date
}

export const SysUserDeviceSchema
  = SchemaFactory.createForClass(SysUserDeviceModel)

// Virutal
addVirtualDeviceThroughDeviceId(SysUserDeviceSchema)
addVirtualUserThroughUserId(SysUserDeviceSchema)

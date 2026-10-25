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

/**
 * B6 起本 schema 不再注册进 Mongoose（模型注册随迁移摘除），仅作为 DTO 链的
 * 校验/swagger 元数据基座保留；@Prop / virtual 不再有运行时语义。
 * userId 的 uuid 校验在 DTO 子类重声明（同 B1 模板）；deviceId 保持字符串业务键。
 */
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

  // B6：PG 侧 user_id 是 uuid（FK → sys_user(id)，phase2 4.9）；属性 TS 类型随列型
  // 放开为 string（uuid 校验在 DTO 子类重声明接管）
  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'user id',
    },
  })
  @Prop({ type: Types.ObjectId, required: true, ref: WalnutDBModelName.SYS_USER })
  userId: string

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

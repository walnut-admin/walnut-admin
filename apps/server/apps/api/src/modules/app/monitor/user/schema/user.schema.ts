import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { RealPickType } from '@walnut-server/utils/dto'
import { IsOptional } from 'class-validator'

import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { addVirtualDeviceThroughDeviceId, IVirtualDevice } from '@/common/model/virtual/device'
import { addVirtualUserThroughUserId, IVirtualUser } from '@/common/model/virtual/user'

export type IAppMonitorUserDocument = HydratedDocument<
  AppMonitorUserModel & IAppMonitorUserMethods & IVirtualDevice & IVirtualUser
>

export type IAppMonitorUserModel = Model<IAppMonitorUserDocument>
  & IAppMonitorUserStatics

interface IAppMonitorUserMethods { }

interface IAppMonitorUserStatics { }

/**
 * B6 起本 schema 不再注册进 Mongoose（模型注册随迁移摘除），仅作为 DTO 链的
 * 校验/swagger 元数据基座保留；@Prop / virtual 不再有运行时语义。
 * userId 的 uuid 校验在 DTO 子类重声明（同 B1 模板）；deviceId 保持字符串业务键。
 */
@Schema({
  collection: WalnutDBCollectionName.APP_MONITOR_USER,
  versionKey: false,
  timestamps: {
    createdAt: 'firstVisitAt',
    updatedAt: 'lastActiveAt',
  },
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class AppMonitorUserModel extends RealPickType(WalnutAdminCommonBasicModel, ['_id'] as const) {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'fingerprint for auth and no auth users',
    },
  })
  @Prop({ type: String, required: true, unique: true, index: true })
  visitorId: string

  // B6：PG 侧 user_id 是可空 uuid 松引用（phase2 4.21）；属性 TS 类型随列型放开为
  // string（uuid 校验在 DTO 子类重声明接管）
  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'user id after auth',
    },
    validateOptions: {
      nullable: true,
    },
  })
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_USER,
  })
  userId: string | null

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'device id' },
  })
  @Prop({
    type: String,
    ref: WalnutDBModelName.SYS_DEVICE,
    required: true,
  })
  deviceId: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'auth or not',
    },
  })
  @Prop({ type: Boolean, default: false })
  auth: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'focus on current page or not',
    },
  })
  @Prop({ type: Boolean, default: true })
  focus: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'left page or not',
    },
  })
  @Prop({ type: Boolean, default: false })
  left: boolean

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'current page router',
    },
  })
  @Prop({ type: String })
  currentRouter: string

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'createdAt, used as `firstVisitAt`',
      required: false,
    },
  })
  @IsOptional({})
  @Prop({ type: Date })
  firstVisitAt: Date

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'updatedAt, used as `lastActiveAt`',
      required: false,
    },
  })
  @IsOptional({})
  @Prop({ type: Date })
  lastActiveAt: Date
}

export const AppMonitorUserSchema
  = SchemaFactory.createForClass(AppMonitorUserModel)

// Virutal
addVirtualDeviceThroughDeviceId(AppMonitorUserSchema)
addVirtualUserThroughUserId(AppMonitorUserSchema)

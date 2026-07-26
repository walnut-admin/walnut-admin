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
  userId: Types.ObjectId | null

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

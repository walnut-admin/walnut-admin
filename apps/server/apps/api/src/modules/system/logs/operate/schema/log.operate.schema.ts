import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { IWalnutAdminConstAppHTTPMethods, WalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'

import { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateType, WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { Recordable } from 'easy-fns-ts'
import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { addVirtualDeviceThroughDeviceId, IVirtualDevice } from '@/common/model/virtual/device'

export type ISysLogOperateDocument = HydratedDocument<
  SysLogOperateModel & ISysLogOperateMethods & IVirtualDevice
>

export type ISysLogOperateModel = Model<ISysLogOperateDocument>
  & ISysLogOperateStatics

interface ISysLogOperateMethods { }

interface ISysLogOperateStatics { }

@Schema({
  collection: WalnutDBCollectionName.LOG_OPERATE,
  versionKey: false,
  timestamps: {
    createdAt: 'operatedAt',
    updatedAt: false,
  },
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysLogOperateModel extends RealPickType(WalnutAdminCommonBasicModel, ['_id'] as const) {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate title, developer customise',
    },
  })
  @Prop({ type: String, required: true, default: null })
  title: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogOperateAction, {
    swaggerOptions: {
      title: 'operate action type',
    },
  })
  @Prop({
    type: String,
    enum: [...Object.values(WalnutAdminConstDecoratorLogOperateAction)],
    default: null,
  })
  actionType: IWalnutAdminConstDecoratorLogOperateAction

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogOperateType, {
    swaggerOptions: {
      title: 'operate type',
    },
  })
  @Prop({
    type: String,
    enum: [...Object.values(WalnutAdminConstDecoratorLogOperateType)],
    default: null,
  })
  operation: IWalnutAdminConstDecoratorLogOperateType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'http method, like get/post',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstAppHTTPMethods)],
    },
  })
  @Prop({
    type: String,
    enum: [...Object.values(WalnutAdminConstAppHTTPMethods)],
    default: null,
  })
  method: IWalnutAdminConstAppHTTPMethods

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'http url',
    },
    validateOptions: {
      url: true,
    },
  })
  @Prop({ type: String, default: null })
  url: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'http version, like 1.1/2.0',
    },
  })
  @Prop({ type: String, default: null })
  httpVersion: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate location, address string',
    },
  })
  @Prop({ type: String, default: null })
  location: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate operating system',
    },
  })
  @Prop({ type: String, default: null })
  os: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate browser',
    },
  })
  @Prop({ type: String, default: null })
  browser: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'http status code',
    },
  })
  @Prop({ type: Number, default: null })
  statusCode: number

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'requset data, stringified',
    },
  })
  // B8 迁 PG（phase2 4.16 / Q7 定案）：列收 jsonb，应用新增直写对象（不再 stringify）；
  // parse 失败原文落同表 raw_request_data text 旁路列。schema 仅作 DTO 元数据基座保留，
  // TS 注解随列型放开为对象（@Prop 不再有运行时语义）；列可空，注解带 null
  @Prop({ type: String, default: null })
  requestData: Recordable | null

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'response data, stringified',
    },
  })
  // B8 迁 PG：同 requestData（jsonb 列 + raw_response_data 旁路）
  @Prop({ type: String, default: null })
  responseData: Recordable | null

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'responsed milliseconds',
    },
  })
  @Prop({ type: Number, default: null })
  correspondingMS: number

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: { title: 'operater user id' },
  })
  // B8 迁 PG（phase2 4.16）：user_id 松引用收 uuid，列可空 —— uuid 校验在 DTO 子类
  // 重声明接管（log.operate.dto.ts 模板），TS 注解随列型放开带 null；本 schema 的
  // Mongo 装饰器仅作为 DTO 元数据基座保留（模型注册已随迁移从 log.operate.module
  // 摘除，@Prop 不再有运行时语义）
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_USER,
    required: true,
  })
  userId: Types.ObjectId | string | null

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operater user name',
    },
  })
  @Prop({ type: String, default: null })
  userName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'operate device id' },
  })
  @Prop({
    type: String,
    ref: WalnutDBModelName.SYS_DEVICE,
    required: true,
  })
  deviceId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate ip',
    },
  })
  @Prop({ type: String, default: null })
  ip: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate invoked service and method',
    },
  })
  @Prop({ type: String, default: null })
  invokingMethod: string

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'operate success or not',
    },
  })
  @Prop({ type: Boolean, default: null })
  success: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'operatedAt, also known as createdAt',
      required: false,
    },
  })
  @IsOptional({})
  @Expose({})
  @Prop({ type: Date })
  operatedAt?: Date

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      description: 'snapshot before, mask sensitive object',
    },
    validateOptions: {
      any: true,
    },
    transformOptions: {
      res: {
        maskSensitive: true,
      },
    },
  })
  @Prop({
    _id: false,
    type: Object,
  })
  snapshotBefore: Recordable

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      description: 'snapshot after, mask sensitive object',
    },
    validateOptions: {
      any: true,
    },
    transformOptions: {
      res: {
        maskSensitive: true,
      },
    },
  })
  @Prop({
    _id: false,
    type: Object,
  })
  snapshotAfter: Recordable
}

export const SysLogOperateSchema
  = SchemaFactory.createForClass(SysLogOperateModel)

// Virtual
addVirtualDeviceThroughDeviceId(SysLogOperateSchema)

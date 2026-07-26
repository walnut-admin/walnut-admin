import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { IWalnutAdminConstAppEnv, WalnutAdminConstAppEnv } from '@walnut-server/const/app/env'
import { IWalnutAdminConstAppHTTPMethods, WalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import { IWalnutAdminConstAppResponseCode, WalnutAdminConstAppResponseCode } from '@walnut-server/const/app/responseCode'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldMongoId, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPickType } from '@walnut-server/utils/dto'
import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

class WalnutAdminRequestHeaders {}

export type IAppErrorDocument = HydratedDocument<
  AppErrorModel & IAppErrorMethods
>

export type IAppErrorModel = Model<IAppErrorDocument> & IAppErrorStatics

export interface IAppErrorMethods { }

export interface IAppErrorStatics { }

class AppErrorPayload {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'request body, json.stringify',
    },
  })
  body: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'request params, json.stringify',
    },
  })
  params: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'request query, json.stringify',
    },
  })
  query: string
}

@Schema({
  collection: WalnutDBCollectionName.APP_ERROR,
  versionKey: false,
  timestamps: {
    createdAt: true,
    updatedAt: false,
  },
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class AppErrorModel extends RealPickType(WalnutAdminCommonBasicModel, ['_id', 'createdAt'] as const) {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'error message',
    },
  })
  @Prop({ type: String, default: null })
  message: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'error stack',
    },
  })
  @Prop({ type: String, default: null })
  stack: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'http status code',
    },
  })
  @Prop({ type: Number })
  statusCode: number

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'path',
    },
  })
  @Prop({ type: String, default: null })
  path: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppHTTPMethods, {
    swaggerOptions: {
      title: 'http method, like get/post',
    },
  })
  @Prop({
    type: String,
    enum: [...Object.values(WalnutAdminConstAppHTTPMethods)],
    default: null,
  })
  method: IWalnutAdminConstAppHTTPMethods

  @WalnutAdminDecoratorFieldObject(WalnutAdminRequestHeaders, {
    swaggerOptions: {
      title: 'request headers',
    },
  })
  @Prop({
    _id: false,
    type: Object,
    default: {},
  })
  headers: object

  @WalnutAdminDecoratorFieldObject(AppErrorPayload, {
    swaggerOptions: {
      title: 'request payload',
    },
  })
  @Prop({
    _id: false,
    type: Object,
  })
  payload: AppErrorPayload

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'error type',
    },
  })
  @Prop({ type: String, default: null })
  errorType: string

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: { title: 'user id' },
  })
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_USER,
  })
  userId: Types.ObjectId | string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppResponseCode, {
    swaggerOptions: {
      title: 'custom response code',
    },
  })
  @Prop({
    type: Number,
    enum: [...Object.values(WalnutAdminConstAppResponseCode)],
    default: null,
  })
  responseCode: IWalnutAdminConstAppResponseCode

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'custom response message',
    },
  })
  @Prop({ type: String, default: null })
  responseMsg: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'ip address',
    },
  })
  @Prop({ type: String, default: null })
  ip: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppEnv, {
    swaggerOptions: {
      title: 'environment',
    },
  })
  @Prop({
    type: String,
    enum: [...Object.values(WalnutAdminConstAppEnv)],
  })
  env: IWalnutAdminConstAppEnv
}

export const AppErrorSchema
  = SchemaFactory.createForClass(AppErrorModel)

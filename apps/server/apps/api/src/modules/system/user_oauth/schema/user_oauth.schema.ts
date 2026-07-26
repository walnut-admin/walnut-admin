import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { ValueOf } from 'easy-fns-ts'
import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export const WalnutAdminConstSysUserOAuthProvider = [
  'google-one-tap',
  'gitee',
  'github',
] as const

export type IWalnutAdminConstSysUserOAuthProvider = ValueOf<
  typeof WalnutAdminConstSysUserOAuthProvider
>

export type ISysUserOAuthDocument = HydratedDocument<
  SysUserOAuthModel & ISysUserOAuthMethods
>

export type ISysUserOAuthModel = Model<ISysUserOAuthDocument>
  & ISysUserOAuthStatics

export interface ISysUserOAuthMethods {}

export interface ISysUserOAuthStatics {}

@Schema({
  collection: WalnutDBCollectionName.USER_OAUTH,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysUserOAuthModel extends WalnutAdminCommonBasicModel {
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

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstSysUserOAuthProvider, {
    swaggerOptions: {
      title: 'oauth provider',
    },
  })
  @Prop({ type: String, required: true })
  provider: IWalnutAdminConstSysUserOAuthProvider

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'oauth provider id',
    },
  })
  @Prop({ type: String, required: true })
  providerId: string

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'what is it?',
    },
  })
  @Prop({ type: Boolean, default: true })
  status: boolean
}

export const SysUserOauthSchema
  = SchemaFactory.createForClass(SysUserOAuthModel)

// 👇 复合唯一索引：同一个外部账号只能绑定一个用�?
SysUserOauthSchema.index({ provider: 1, providerId: 1 }, { unique: true })
// 👇 查询用户的所有OAuth绑定
SysUserOauthSchema.index({ userId: 1, enabled: 1 })

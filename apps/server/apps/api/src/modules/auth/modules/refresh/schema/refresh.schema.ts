import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { IWalnutAdminConstRevokeRTType, WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'

import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { HydratedDocument, Model, Types } from 'mongoose'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export type IAuthRefreshTokenDocument = HydratedDocument<
  AuthRefreshTokenModel & IAuthRefreshTokenMethods
>

export type IAuthRefreshTokenModel = Model<IAuthRefreshTokenDocument> & IAuthRefreshTokenStatics

interface IAuthRefreshTokenMethods { }

interface IAuthRefreshTokenStatics { }

@Schema({
  collection: WalnutDBCollectionName.AUTH_REFRESH_TOKEN,
  versionKey: false,
  timestamps: {
    createdAt: true,
    updatedAt: false,
  },
})
export class AuthRefreshTokenModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'refresh token jti',
    },
  })
  @Prop({ type: String, unique: true, required: true, index: true })
  jti: string

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'user id when auth',
    },
  })
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_USER,
    required: true,
  })
  userId: Types.ObjectId | string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device id, refer to device collection',
    },
  })
  @Prop({
    type: String,
    ref: WalnutDBModelName.SYS_DEVICE,
    required: true,
  })
  deviceId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'hashed refresh token',
    },

  })
  @Prop({ type: String, required: true })
  encryptedToken: string

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'token expiredAt time',
    },
  })
  @Prop({ type: Date, required: true })
  expiredAt: Date

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'token revoked',
    },
  })
  @Prop({ type: Boolean, default: false })
  revoked: boolean

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstRevokeRTType, {
    swaggerOptions: {
      title: 'revoke reason',
    },
  })
  @Prop({
    type: String,
    enum: [...Object.values(WalnutAdminConstRevokeRTType)],
    default: null,
  })
  revokeReason: IWalnutAdminConstRevokeRTType
}

export const AuthRefreshTokenSchema = SchemaFactory.createForClass(AuthRefreshTokenModel)

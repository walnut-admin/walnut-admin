import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { IWalnutAdminConstRoleMode, WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { } from '@walnut/contract'

import { ValueOf } from 'easy-fns-ts'

import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { addVirtualRolesCount, addVirtualRolesList, IVirtualRolesCount, IVirtualRolesList } from '@/common/model/virtual/role'

export type ISysUserDocument = HydratedDocument<SysUserModel & ISysUserMethods & IVirtualRolesList & IVirtualRolesCount>

export type ISysUserModel = Model<ISysUserDocument> & ISysUserStatics

interface ISysUserMethods { }

interface ISysUserStatics { }

export const SysUserGenderConst = {
  UNKNOWN: 0,
  MALE: 1,
  FEMALE: 2,
  UNDESCRIBED: 9,
} as const

export type SysUserGenderConstType = ValueOf<typeof SysUserGenderConst>

@Schema({
  collection: WalnutDBCollectionName.USER,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysUserModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'user name',
      description: 'should be unique, used for normal password sign in',
    },
  })
  @Prop({
    type: String,
    default: null,
    // https://stackoverflow.com/a/47413794
    index: {
      unique: true,
      partialFilterExpression: { userName: { $type: 'string' } },
    },
  })
  userName: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'user nick name',
      description: 'feel free to change',
    },
  })
  @Prop({ type: String, default: null })
  nickName: string

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'age',
      description: 'should be int and positive',
    },
    validateOptions: { int: true, positive: true },
  })
  @Prop({
    type: Number,
    default: null,
  })
  age: number

  @WalnutAdminDecoratorFieldEnum(() => SysUserGenderConst, {
    default: SysUserGenderConst.UNDESCRIBED,
    swaggerOptions: {
      title: 'gender',
      description: 'follow GB standard, go internet it',
      example: SysUserGenderConst.UNDESCRIBED,
    },
  })
  @Prop({
    type: () => SysUserGenderConst,
    enum: [...Object.values(SysUserGenderConst)],
    default: SysUserGenderConst.UNDESCRIBED,
  })
  gender: SysUserGenderConstType

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'avatar',
      description: 'maybe a transform in the future',
    },
    // TODO add oss prefix
    transformOptions: {},
  })
  @Prop({ type: String, default: null })
  avatar: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'description',
      description: 'feel free to change',
    },
    validateOptions: {},
  })
  @Prop({ type: String, default: null })
  description: string

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'user status',
      description:
        'false => user cannot sign in anymore, also should ban tokens as well',
    },
  })
  @Prop({ type: Boolean, default: true })
  status: boolean

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'role id array',
      description: 'one user can have multiple roles',
    },
    isArray: true,
    arrayOptions: {
      unique: true,
    },
  })
  @Prop([
    {
      type: Types.ObjectId,
      ref: WalnutDBModelName.SYS_ROLE,
      unique: true,
    },
  ])
  roles: Types.ObjectId[] | string[]

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstRoleMode, {
    default: WalnutAdminConstRoleMode.SWITCH,
    swaggerOptions: {
      title: 'role mode',
      description: `switch => user can switch role freely; combine => user's role is combined by system, along with the permission, user would access all permission in the roles he has`,
      example: WalnutAdminConstRoleMode.SWITCH,
    },
  })
  @Prop({
    type: () => WalnutAdminConstRoleMode,
    enum: [...Object.values(WalnutAdminConstRoleMode)],
    default: WalnutAdminConstRoleMode.SWITCH,
  })
  roleMode: IWalnutAdminConstRoleMode

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'role id',
      description: `user's current role id`,
    },
  })
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_ROLE,
  })
  currentRole: Types.ObjectId | string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'MFA setup',
      description:
        'true => user has setup MFA',
    },
  })
  @Prop({ type: Boolean, default: false })
  mfaSetup: boolean
}

export const SysUserSchema = SchemaFactory.createForClass(SysUserModel)

// Virtual
addVirtualRolesList(SysUserSchema)
addVirtualRolesCount(SysUserSchema)

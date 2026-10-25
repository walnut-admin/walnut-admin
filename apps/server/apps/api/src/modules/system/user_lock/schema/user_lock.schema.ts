import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'

import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPartialType } from '@walnut-server/utils/dto'
import { Recordable, ValueOf } from 'easy-fns-ts'
import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export type ISysUserLockDocument = HydratedDocument<
  SysUserLockModel & ISysUserLockMethods
>

export type ISysUserLockModel = Model<ISysUserLockDocument>
  & ISysUserLockStatics

export interface ISysUserLockMethods {}

export interface ISysUserLockStatics {}

export const LockModeConst = {
  DEFAULT: 'default',
  IDLE: 'idle',
  SECURITY: 'security',
} as const

type ILockModeConst = ValueOf<typeof LockModeConst>

class SysUserLockRouteRaw {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'lock route name',
    },
  })
  name: string

  @WalnutAdminDecoratorFieldObject(Object, {
    validateOptions: {
      any: true,
    },
  })
  query: Recordable

  @WalnutAdminDecoratorFieldObject(Object, {
    validateOptions: {
      any: true,
    },
  })
  params: Recordable
}

class SysUserLockRouteType extends RealPartialType(SysUserLockRouteRaw) { }

@Schema({
  collection: WalnutDBCollectionName.USER_LOCK,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysUserLockModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'user id',
    },
  })
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_USER,
    required: true,
  })
  userId: Types.ObjectId | string

  @WalnutAdminDecoratorFieldObject(SysUserLockRouteType, {
    swaggerOptions: {
      title: 'user lock route',
    },
  })
  @Prop({
    _id: false,
    default: {},
    type: {
      name: String,
      query: Object,
      params: Object,
    },
  })
  lockRoute: InstanceType<typeof SysUserLockRouteType> | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'lock password hash',
    },
  })
  @Prop({ type: String, default: null })
  lockPwdHash: string

  @WalnutAdminDecoratorFieldEnum(() => LockModeConst, {
    default: LockModeConst.DEFAULT,
    swaggerOptions: {
      title: 'lock mode, default, idle, security',
      example: LockModeConst.DEFAULT,
    },
  })
  @Prop({
    type: () => LockModeConst,
    enum: [...Object.values(LockModeConst)],
    default: LockModeConst.DEFAULT,
  })
  lockMode: ILockModeConst

  @WalnutAdminDecoratorFieldNumber({
    default: 600,
    swaggerOptions: {
      title: 'lock idle seconds',
    },
  })
  @Prop({ type: Number, default: 600 })
  lockIdleSec: number

  @WalnutAdminDecoratorFieldNumber({
    default: 60,
    swaggerOptions: {
      title: 'lock security seconds',
    },
  })
  @Prop({ type: Number, default: 60 })
  lockSecuritySec: number

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'lock cross device?',
    },
  })
  @Prop({ type: Boolean, default: true })
  lockCrossDevice: boolean
}

export const SysUserLockSchema = SchemaFactory.createForClass(SysUserLockModel)

// B7b 迁移注记：原此处的 pre('save') bcrypt hash 钩子已迁到 PG 仓库的写入路径
// （SysUserLockRepositoryService.insertOrUpdateUserLockPre，写入路径全覆盖）；
// 本 schema 仅承载 DTO 校验/swagger 元数据（模型注册已摘除，钩子不再有执行时机）。

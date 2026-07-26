import { Prop, Schema, SchemaFactory, Virtual } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut/decorators/field'

import { HydratedDocument, Model, Types } from 'mongoose'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { SysMenuDTOSafe } from '../../menu/dto/menu.dto'
import { ISysMenuDocument } from '../../menu/schema/menu.schema'

export type ISysRoleDocument = HydratedDocument<SysRoleModel & ISysRoleMethods>

export type ISysRoleModel = Model<ISysRoleDocument> & ISysRoleStatics

export interface ISysRoleMethods {}

export interface ISysRoleStatics {}

@Schema({
  collection: WalnutDBCollectionName.ROLE,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysRoleModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'role name',
      description: 'unique string',
    },
  })
  @Prop({ type: String, default: null, unique: true })
  roleName: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'role description',
      description: 'short describe',
    },
  })
  @Prop({ type: String, default: null })
  description: string

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'role order',
      description: 'should be int',
    },
    validateOptions: { int: true },
  })
  @Prop({ type: Number, default: null })
  order: number

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'menu id array',
      description: 'ref to menu model',
    },
    isArray: true,
    arrayOptions: {
      unique: true,
    },
  })
  @Prop([
    {
      type: Types.ObjectId,
      ref: WalnutDBModelName.SYS_MENU,
      unique: true,
    },
  ])
  menus: Types.ObjectId[]

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'role status',
      description:
        'false => users wont retrieve current role menus(permissions)',
    },
  })
  @Prop({ type: Boolean, default: true })
  status: boolean

  // virtual
  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `current role's user count`,
    },
  })
  @Virtual({
    options: {
      ref: WalnutDBModelName.SYS_USER,
      localField: '_id',
      foreignField: 'roles',
      count: true,
    },
  })
  populated_usersCount: number

  @WalnutAdminDecoratorFieldObject(SysMenuDTOSafe, {
    isArray: true,
    swaggerOptions: {
      title: 'populated menus list',
    },
  })
  @Virtual({
    options: {
      ref: WalnutDBModelName.SYS_MENU,
      localField: 'menus',
      foreignField: '_id',
      match: { 'meta.status': true },
    },
  })
  populated_menusList: ISysMenuDocument[]
}

export const SysRoleSchema = SchemaFactory.createForClass(SysRoleModel)

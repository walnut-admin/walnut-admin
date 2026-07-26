import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName } from '@walnut/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut/decorators/field'

import { WalnutAdminDecoratorFieldObject } from '@walnut/decorators/field/object.decorator'
import { RealPartialType } from '@walnut/utils/dto'
import { Recordable, ValueOf } from 'easy-fns-ts'
import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export type ISysMenuDocument = HydratedDocument<SysMenuModel & ISysMenuMethods>

export type ISysMenuModel = Model<ISysMenuDocument> & ISysMenuStatics

export interface ISysMenuMethods { }

export interface ISysMenuStatics { }

export const SysMenuTypeConst = {
  CATALOG: 'catalog',
  MENU: 'menu',
  ELEMENT: 'element',
} as const

export type ISysMenuTypeConst = ValueOf<typeof SysMenuTypeConst>

export const SysMenuTernalConst = {
  EXTERNAL: 'external',
  INTERNAL: 'internal',
  NONE: 'none',
} as const

export type ISysMenuTernalConst = ValueOf<typeof SysMenuTernalConst>

const SysMenuCacheKeyStrategyConst = {
  NAME: 'name',
  PATH: 'path',
  CUSTOM: 'custom',
} as const

export type ISysMenuCacheKeyStrategyConst = ValueOf<typeof SysMenuCacheKeyStrategyConst>

export class SysMenuModelMeta {
  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'menu order',
      description: 'should be int',
    },
    validateOptions: { int: true },
  })
  @Prop({ type: Number, default: null })
  order: number

  @WalnutAdminDecoratorFieldEnum(() => SysMenuTernalConst, {
    default: SysMenuTernalConst.NONE,
    swaggerOptions: {
      title: 'menu ternal type',
      description:
        'internal => no jump, iframe inside page. external => jump url, need to confirm',
      example: SysMenuTernalConst.NONE,
    },
  })
  @Prop({
    type: () => SysMenuTernalConst,
    enum: [...Object.values(SysMenuTernalConst)],
    default: SysMenuTernalConst.NONE,
  })
  ternal: ISysMenuTernalConst

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'ternal url',
      description: 'should be a full and real url',
    },
    validateOptions: {
      url: true,
    },
  })
  @Prop({ type: String, default: null })
  url: string

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'menu show status',
      description:
        'false => will be filtered in front end. set this false when need to hide a page like detail which not necessary in menu and tabs',
    },
  })
  @Prop({ type: Boolean, default: true })
  show: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'menu cache status',
      description: 'true => will be cached in keep-alive',
    },
  })
  @Prop({ type: Boolean, default: false })
  cache: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'menu status',
      description: 'false => will not be retrieved from database',
    },
  })
  @Prop({ type: Boolean, default: true })
  status: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'tab status',
      description: 'true => tab will be affixed in left/right',
    },
  })
  @Prop({ type: Boolean, default: false })
  affix: boolean

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'permission string',
      description: 'permission string, mostly like *:*:*',
    },
  })
  @Prop({ type: String, default: null })
  permission: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'menu active name',
      description:
        'used for show=false page, tell front end to active which menu when show=false page is opened',
    },
  })
  @Prop({ type: String, default: null })
  menuActiveName: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'menu active same tab',
      description:
        'mostly used with `menuActiveName`, true => no new tab for show=false page',
    },
  })
  @Prop({ type: Boolean, default: false })
  menuActiveSameTab: boolean

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'menu badge',
      description:
        'menu badge, normally red dot or a number or a ???character',
    },
  })
  @Prop({ type: String, default: null })
  badge: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'menu active icon',
      description:
        'show different icon when menu is activited, icon show follow iconify and unocss rules',
    },
  })
  @Prop({ type: String, default: null })
  activeIcon: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'page scroll position status',
      description: 'true => remember scroll postion for the user',
    },
  })
  @Prop({ type: Boolean, default: false })
  position: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'page leave tip',
      description:
        'true => will show a leave confirm message modal to make sure ready to leave current page',
    },
  })
  @Prop({ type: Boolean, default: false })
  leaveTip: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'browser url masking, including path/params/query',
    },
  })
  @Prop({ type: Boolean, default: false })
  maskUrl: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'hijack refresh token',
      description:
        'true => will hijack refresh token in front end',
    },
  })
  @Prop({ type: Boolean, default: false })
  hijackRefresh: boolean

  @WalnutAdminDecoratorFieldObject(Object, {
    validateOptions: {
      any: true,
    },
  })
  @Prop({
    _id: false,
    type: Object,
  })
  watermark: Recordable

  @WalnutAdminDecoratorFieldString({
    default: 'fade',
    swaggerOptions: {
      title: 'transition name',
      description:
        'used for vue transition name',
    },
  })
  @Prop({ type: String, default: 'fade' })
  transition: string

  @WalnutAdminDecoratorFieldEnum(() => SysMenuCacheKeyStrategyConst, {
    default: null,
    swaggerOptions: {
      title: 'cache key strategy',
      description:
        'name => use menu name as cache key. path => use menu path as cache key',
      example: SysMenuCacheKeyStrategyConst.NAME,
    },
  })
  @Prop({
    type: () => SysMenuCacheKeyStrategyConst,
    enum: [...Object.values(SysMenuCacheKeyStrategyConst)],
    default: null,
  })
  cacheKeyStrategy: ISysMenuCacheKeyStrategyConst
}

@Schema({
  collection: WalnutDBCollectionName.MENU,
  versionKey: false,
  timestamps: true,
})
export class SysMenuModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'parent node menu id',
      description: 'root node menu id is not changeable',
    },
  })
  @Prop({ type: Types.ObjectId, required: true })
  pid: Types.ObjectId | string

  @WalnutAdminDecoratorFieldEnum(() => SysMenuTypeConst, {
    default: SysMenuTypeConst.CATALOG,
    swaggerOptions: {
      title: 'basic menu type, mostly used in front end',
      description:
        'catalog => like folder, can only have child nodes. menu => refer to route. element => front end element permission',
      example: SysMenuTypeConst.CATALOG,
    },
  })
  @Prop({
    type: () => SysMenuTypeConst,
    enum: [...Object.values(SysMenuTypeConst)],
    default: SysMenuTypeConst.CATALOG,
  })
  type: ISysMenuTypeConst

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route path',
      description: 'used for vue router path',
    },
  })
  @Prop({ type: String, default: null })
  path: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route name',
      description:
        'used for vue router name, should be unique, also used for keep-alive flags',
    },
  })
  @Prop({
    type: String,
    default: null,
    // https://stackoverflow.com/a/47413794
    index: {
      unique: true,
      partialFilterExpression: { name: { $type: 'string' } },
    },
  })
  name: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route component file path',
      description: 'used for vue router to find target file path',
    },
  })
  @Prop({ type: String, default: null })
  component: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route title',
      description: 'used for route page title, mostly is i18n format',
    },
  })
  @Prop({ type: String, default: null })
  title: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route icon',
      description: 'used for route icon, shown in menus and tabs',
    },
  })
  @Prop({ type: String, default: null })
  icon: string

  @WalnutAdminDecoratorFieldObject(RealPartialType(SysMenuModelMeta), {
    swaggerOptions: {
      title: 'menu meta data, lots of fields',
    },
  })
  @Prop({ type: SysMenuModelMeta, _id: false })
  meta: SysMenuModelMeta
}

export const SysMenuSchema = SchemaFactory.createForClass(SysMenuModel)

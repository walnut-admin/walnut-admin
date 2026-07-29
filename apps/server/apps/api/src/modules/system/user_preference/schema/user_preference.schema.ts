import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldMongoId } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { Locale, LocaleType } from '@walnut/contract'
import { ValueOf } from 'easy-fns-ts'
import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export type ISysUserPreferenceDocument = HydratedDocument<
  SysUserPreferenceModel & ISysUserPreferenceMethods
>

export type ISysUserPreferenceModel = Model<ISysUserPreferenceDocument>
  & ISysUserPreferenceStatics

export interface ISysUserPreferenceMethods {}

export interface ISysUserPreferenceStatics {}

export const fontSizeConst = {
  10: 10,
  12: 12,
  14: 14,
  16: 16,
  20: 20,
} as const

type IFontSizeConst = ValueOf<typeof fontSizeConst>

export const colorModeConst = {
  DEFAULT: 'default',
  CAFE: 'cafe',
  CONTRAST: 'contrast',
  GRAYSCALE: 'grayscale',
  GRAYSCALE_INVERTED: 'grayscale-inverted',
  INVERTED: 'inverted',
} as const

export type IColorModeConst
  = ValueOf<typeof colorModeConst>

export const CVDConst = {
  DEFAULT: 'default',
  PROTANOPIA: 'protanopia', // no red
  DEUTERANOPIA: 'deuteranopia', // no green
  TRITANOPIA: 'tritanopia', // no blue
  ACHROMATOPIA: 'achromatopsia', // no color
} as const

export type ICVDConst
  = ValueOf<typeof CVDConst>

export const layoutModeConst = {
  LEFT_MENU: 'left-menu',
  TOP_MENU: 'top-menu',
} as const

export type ILayoutModeConst
  = ValueOf<typeof layoutModeConst>

@Schema({
  collection: WalnutDBCollectionName.USER_PREFERENCE,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysUserPreferenceModel extends WalnutAdminCommonBasicModel {
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

  @WalnutAdminDecoratorFieldEnum(() => fontSizeConst, {
    default: fontSizeConst[14],
    swaggerOptions: {
      title: 'font size',
      example: fontSizeConst[14],
    },
  })
  @Prop({
    type: () => fontSizeConst,
    enum: [...Object.values(fontSizeConst)],
    default: fontSizeConst[14],
  })
  fontSize: IFontSizeConst

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'dark mode?',
    },
  })
  @Prop({ type: Boolean, default: false })
  dark: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'reduced motion?',
    },
  })
  @Prop({ type: Boolean, default: false })
  reducedMotion: boolean

  @WalnutAdminDecoratorFieldEnum(() => colorModeConst, {
    default: colorModeConst.DEFAULT,
    swaggerOptions: {
      title: 'Color Vision Deficiency',
      example: colorModeConst.DEFAULT,
    },
  })
  @Prop({
    type: () => colorModeConst,
    enum: [...Object.values(colorModeConst)],
    default: colorModeConst.DEFAULT,
  })
  colorMode: IColorModeConst

  @WalnutAdminDecoratorFieldEnum(() => CVDConst, {
    default: null,
    swaggerOptions: {
      title: 'color Blind',
      example: CVDConst.DEFAULT,
    },
  })
  @Prop({
    type: () => CVDConst,
    enum: [...Object.values(CVDConst)],
    default: null,
  })
  CVD: ICVDConst

  @WalnutAdminDecoratorFieldEnum(() => Locale, {
    default: Locale.zh_CN,
    swaggerOptions: {
      title: 'locale',
      example: Locale.zh_CN,
    },
  })
  @Prop({
    type: () => Locale,
    enum: [...Object.values(Locale)],
    default: Locale.zh_CN,
  })
  locale: LocaleType

  @WalnutAdminDecoratorFieldEnum(() => layoutModeConst, {
    default: layoutModeConst.LEFT_MENU,
    swaggerOptions: {
      title: 'layout mode',
      example: layoutModeConst.LEFT_MENU,
    },
  })
  @Prop({
    type: () => layoutModeConst,
    enum: [...Object.values(layoutModeConst)],
    default: layoutModeConst.LEFT_MENU,
  })
  layoutMode: ILayoutModeConst

  @WalnutAdminDecoratorFieldObject(Object, {
    default: {},
    swaggerOptions: {
      title: 'layout',
    },
    validateOptions: {
      any: true,
    },
  })
  @Prop({
    _id: false,
    default: {},
    type: Object,
  })
  layout: object
}

export const SysUserPreferenceSchema = SchemaFactory.createForClass(SysUserPreferenceModel)

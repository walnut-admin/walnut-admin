import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldEnum } from '@walnut-server/decorators/field'

import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { Locale, LocaleType } from '@walnut/contract'
import { Expose } from 'class-transformer'
import { ValueOf } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

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

export class SysUserPreferenceModel extends WalnutAdminCommonBasicModel {
  @Expose()
  userId: string

  @WalnutAdminDecoratorFieldEnum(() => fontSizeConst, {
    default: fontSizeConst[14],
    swaggerOptions: {
      title: 'font size',
      example: fontSizeConst[14],
    },
  })
  fontSize: IFontSizeConst

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'dark mode?',
    },
  })
  dark: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'reduced motion?',
    },
  })
  reducedMotion: boolean

  @WalnutAdminDecoratorFieldEnum(() => colorModeConst, {
    default: colorModeConst.DEFAULT,
    swaggerOptions: {
      title: 'Color Vision Deficiency',
      example: colorModeConst.DEFAULT,
    },
  })
  colorMode: IColorModeConst

  @WalnutAdminDecoratorFieldEnum(() => CVDConst, {
    default: null,
    swaggerOptions: {
      title: 'color Blind',
      example: CVDConst.DEFAULT,
    },
  })
  CVD: ICVDConst

  @WalnutAdminDecoratorFieldEnum(() => Locale, {
    default: Locale.zh_CN,
    swaggerOptions: {
      title: 'locale',
      example: Locale.zh_CN,
    },
  })
  locale: LocaleType

  @WalnutAdminDecoratorFieldEnum(() => layoutModeConst, {
    default: layoutModeConst.LEFT_MENU,
    swaggerOptions: {
      title: 'layout mode',
      example: layoutModeConst.LEFT_MENU,
    },
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
  layout: object
}

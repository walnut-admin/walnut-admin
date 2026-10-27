import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldEnum } from '@walnut-server/decorators/field'

import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { Locale, LocaleType } from '@walnut/contract'
import { Expose } from 'class-transformer'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { colorModeConst, CVDConst, fontSizeConst, IColorModeConst, ICVDConst, IFontSizeConst, ILayoutModeConst, layoutModeConst } from '../preference.const'

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

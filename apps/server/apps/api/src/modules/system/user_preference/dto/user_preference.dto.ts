import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPickType } from '@walnut-server/utils/dto'
import { Locale, LocaleType } from '@walnut/contract'
import { Expose } from 'class-transformer'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { colorModeConst, CVDConst, fontSizeConst, fontSizeValues, IColorModeConst, ICVDConst, IFontSizeConst, ILayoutModeConst, layoutModeConst } from '../preference.const'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/user_preference.schema.ts 的
// SysUserPreferenceModel 改名 SysUserPreferenceDTOBase），装饰器与字段本体零改动
export class SysUserPreferenceDTOBase extends WalnutAdminCommonBasicModel {
  @Expose()
  userId: string

  // P3-13：enum 源用值数组（fontSizeValues），数字键对象直传会产出空 enum
  // → openapi-typescript 生成 `fontSize: never`
  @WalnutAdminDecoratorFieldEnum(() => fontSizeValues, {
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

export class SysUserPreferenceDTO extends SysUserPreferenceDTOBase {
  constructor(partial: Partial<SysUserPreferenceDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserPreferenceDTOBasicRequest extends RealPickType(SysUserPreferenceDTOBase, ['locale']) {
  constructor(partial: Partial<SysUserPreferenceDTOBasicRequest>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserPreferenceDTOAccessibilityRequest extends RealPickType(SysUserPreferenceDTOBase, ['fontSize', 'reducedMotion', 'CVD', 'colorMode']) {
  constructor(partial: Partial<SysUserPreferenceDTOAccessibilityRequest>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserPreferenceDTOThemeRequest extends RealPickType(SysUserPreferenceDTOBase, ['dark']) {
  constructor(partial: Partial<SysUserPreferenceDTOThemeRequest>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserPreferenceDTOLayoutRequest extends RealPickType(SysUserPreferenceDTOBase, ['layoutMode', 'layout']) {
  constructor(partial: Partial<SysUserPreferenceDTOLayoutRequest>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserPreferenceResponseDTO {
  constructor(partial: Partial<SysUserPreferenceResponseDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysUserPreferenceDTOBasicRequest, {
    swaggerOptions: {
      title: 'basic preference',
    },
  })
  basic: SysUserPreferenceDTOBasicRequest

  @WalnutAdminDecoratorFieldObject(SysUserPreferenceDTOAccessibilityRequest, {
    swaggerOptions: {
      title: 'accessibility preference',
    },
  })
  accessibility: SysUserPreferenceDTOAccessibilityRequest

  @WalnutAdminDecoratorFieldObject(SysUserPreferenceDTOThemeRequest, {
    swaggerOptions: {
      title: 'theme preference',
    },
  })
  theme: SysUserPreferenceDTOThemeRequest

  @WalnutAdminDecoratorFieldObject(SysUserPreferenceDTOLayoutRequest, {
    swaggerOptions: {
      title: 'layout preference',
    },
  })
  layout: SysUserPreferenceDTOLayoutRequest
}

import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPickType } from '@walnut-server/utils/dto'
import { SysUserPreferenceModel } from '../schema/user_preference.schema'

export class SysUserPreferenceDTO extends SysUserPreferenceModel {
  constructor(partial: Partial<SysUserPreferenceDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserPreferenceDTOBasicRequest extends RealPickType(SysUserPreferenceModel, ['locale']) {
  constructor(partial: Partial<SysUserPreferenceDTOBasicRequest>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserPreferenceDTOAccessibilityRequest extends RealPickType(SysUserPreferenceModel, ['fontSize', 'reducedMotion', 'CVD', 'colorMode']) {
  constructor(partial: Partial<SysUserPreferenceDTOAccessibilityRequest>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserPreferenceDTOThemeRequest extends RealPickType(SysUserPreferenceModel, ['dark']) {
  constructor(partial: Partial<SysUserPreferenceDTOThemeRequest>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserPreferenceDTOLayoutRequest extends RealPickType(SysUserPreferenceModel, ['layoutMode', 'layout']) {
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

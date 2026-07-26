import { IntersectionType } from '@nestjs/swagger'
import { IWalnutAdminConstAppSettingType, WalnutAdminConstAppSettingType } from '@walnut/const/app/setting'
import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldEnum } from '@walnut/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut/decorators/field/object.decorator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut/utils/dto'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { AppSettingModel } from '../schema/setting.schema'

export class AppSettingDTO extends AppSettingModel {
  constructor(partial: Partial<AppSettingDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class AppSettingDTOSafe extends RealOmitType(
  AppSettingModel,
  [] as const,
) {
  constructor(partial: Partial<AppSettingDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

class AppSettingDTOSafeRequest extends RealPartialType(RealOmitType(AppSettingDTOSafe, ['settingType'] as const)) {
  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppSettingType, {
    isArray: true,
    swaggerOptions: {
      title: 'setting type for request query, support array',
    },
  })
  @IsOptional({ each: true })
  settingType: IWalnutAdminConstAppSettingType
}

// list
export class AppSettingDTOListRequest extends CreateWalnutAdminRequestListDTO(
  AppSettingDTOSafeRequest,
) {}

export class AppSettingDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(AppSettingDTOSafe),
) {}

// create
export class AppSettingDTOCreateRequest extends IntersectionType(RealPickType(
  AppSettingDTOSafe,
  ['settingKey', 'settingName', 'settingValue', 'settingType'] as const,
), RealPartialType(RealPickType(
  AppSettingDTOSafe,
  ['remark'] as const,
))) {}
export class AppSettingDTOCreateResponse extends AppSettingDTOSafe {}

// read
export class AppSettingDTOReadResponse extends AppSettingDTOSafe {}

// update
export class AppSettingDTOUpdateRequest extends IntersectionType(RealPickType(
  AppSettingDTOSafe,
  ['settingKey', 'settingName', 'settingValue', 'settingType'] as const,
), RealPartialType(RealPickType(
  AppSettingDTOSafe,
  ['remark'] as const,
))) {}
export class AppSettingDTOUpdateResponse extends AppSettingDTOSafe {}

class AppSettingDTOPublicAuthOpaque {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'opaque auth enable',
    },
  })
  enable: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'register auth enable',
    },
  })
  register: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'forget auth enable',
    },
  })
  forget: boolean
}

// public setting
class AppSettingDTOPublicAuth {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'email auth enable',
    },
  })
  email: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'phone auth enable',
    },
  })
  phone: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'qrcode auth enable',
    },
  })
  qrcode: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'gitee auth enable',
    },
  })
  gitee: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'github auth enable',
    },
  })
  github: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'google auth enable',
    },
  })
  google: boolean

  @WalnutAdminDecoratorFieldObject(AppSettingDTOPublicAuthOpaque, {
    swaggerOptions: {
      title: 'opaque register/forget',
    },
  })
  opaque: {
    register: boolean
    forget: boolean
  }
}

class AppSettingDTOPublicFrontend {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'full screen enable',
    },
  })
  fullScreen: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'search enable',
    },
  })
  search: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'dark mode enable',
    },
  })
  dark: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'locale enable',
    },
  })
  locale: boolean
}
export class AppSettingDTOPublicResponse {
  constructor(partial: Partial<AppSettingDTOPublicResponse>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(AppSettingDTOPublicAuth, {})
  auth: AppSettingDTOPublicAuth

  @WalnutAdminDecoratorFieldObject(AppSettingDTOPublicFrontend, {})
  frontend: AppSettingDTOPublicFrontend
}

import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { IWalnutAdminConstAppSettingType, WalnutAdminConstAppSettingType } from '@walnut-server/const/app/setting'
import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/setting.schema.ts 的 AppSettingModel
// 改名 AppSettingDTOBase），装饰器与字段本体零改动
export class AppSettingDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'setting name',
    },
  })
  settingName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'setting key',
    },
  })
  settingKey: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'setting value',
    },
  })
  settingValue: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppSettingType, {
    swaggerOptions: {
      title: 'setting type',
    },
  })
  settingType: IWalnutAdminConstAppSettingType

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'setting remark',
    },
  })
  remark: string
}

export class AppSettingDTO extends AppSettingDTOBase {
  constructor(partial: Partial<AppSettingDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.19）：B1 模板 —— @Expose 供响应序列化与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class AppSettingDTOSafe extends AppSettingDTO {
  constructor(partial: Partial<AppSettingDTOSafe>) {
    super(partial)
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

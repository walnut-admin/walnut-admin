import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { IWalnutAdminConstAppSettingScopeType, IWalnutAdminConstAppSettingType, WalnutAdminConstAppSettingScopeType, WalnutAdminConstAppSettingType } from '@walnut-server/const/app/setting'
import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { WalnutAdminCommonBasicModel } from '@walnut-server/identity'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@walnut-server/list'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'

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
  // uuid pipe），可选性由 required: false + default: null + uuid nullable 表达，字段不写 ?（F-38）
  @Expose()
  @ApiProperty({ type: String, required: false, default: null })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id: string
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class AppSettingDTOSafe extends AppSettingDTO {
  constructor(partial: Partial<AppSettingDTOSafe>) {
    super(partial)
  }
}

class AppSettingDTOSafeRequest extends RealPartialType(RealOmitType(AppSettingDTOSafe, ['settingType'] as const)) {
  // 列表查询可选过滤：query 信封不挂 ValidateNested（见 list.dto.ts 的 required: false），
  // enum 校验器也没有 nullable 选项 —— 此处无需 IsOptional（F-38：不裸挂 class-validator）
  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppSettingType, {
    isArray: true,
    swaggerOptions: {
      title: 'setting type for request query, support array',
    },
  })
  settingType: IWalnutAdminConstAppSettingType
}

// list
// L2 sort 白名单：admin setting 列表只排 createdAt/updatedAt（views/app/setting 的
// WTablePresetCreatedAt/UpdatedAtColumn）；settingKey 有 uq_setting_key 但无业务排序
// 诉求，不收。app_setting 无 created_at 索引 → 见报告建议补索引
export class AppSettingDTOListRequest extends CreateWalnutAdminRequestListDTO(
  AppSettingDTOSafeRequest,
  { sortOnlyIn: ['createdAt', 'updatedAt'] },
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

/**
 * 私有（登录态）功能开关 —— GET /app/setting/private 的响应。
 *
 * service 侧把每条 setting 的 scope 解析结果拍平成 { status, mode, value }（mode 即 scope，
 * value 即命中的 globalValue / localValue），admin store 直接消费这个形态做前端开关：
 * status = 功能总开关、mode = 作用域（global 全局 / local 用户级）、value = 取值。
 *
 * F-18（DOC-07）：此前该端点 200 无 schema（api-types 里退化成 unknown），这里只补文档形状，
 * 运行时仍返回 setting.service 的普通对象（DOC-19 的权限面收敛另议）。
 */
class AppSettingDTOPrivateFlagResponse {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'functional switch enabled',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppSettingScopeType, {
    swaggerOptions: {
      title: 'functional switch scope',
    },
  })
  mode: IWalnutAdminConstAppSettingScopeType

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'functional switch value (boolean flag)',
    },
  })
  value: boolean
}

class AppSettingDTOPrivateWatermarkResponse {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'functional switch enabled',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppSettingScopeType, {
    swaggerOptions: {
      title: 'functional switch scope',
    },
  })
  mode: IWalnutAdminConstAppSettingScopeType

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      title: 'watermark config (free-form object)',
    },
  })
  value: Record<string, unknown>
}

class AppSettingDTOPrivateTransitionResponse {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'functional switch enabled',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppSettingScopeType, {
    swaggerOptions: {
      title: 'functional switch scope',
    },
  })
  mode: IWalnutAdminConstAppSettingScopeType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'page transition name',
    },
  })
  value: string
}

export class AppSettingDTOPrivateResponse {
  @WalnutAdminDecoratorFieldObject(AppSettingDTOPrivateFlagResponse, {
    swaggerOptions: {
      title: 'url mask switch',
    },
  })
  maskUrl: AppSettingDTOPrivateFlagResponse

  @WalnutAdminDecoratorFieldObject(AppSettingDTOPrivateFlagResponse, {
    swaggerOptions: {
      title: 'refresh hijack switch',
    },
  })
  hijackRefresh: AppSettingDTOPrivateFlagResponse

  @WalnutAdminDecoratorFieldObject(AppSettingDTOPrivateWatermarkResponse, {
    swaggerOptions: {
      title: 'watermark switch',
    },
  })
  watermark: AppSettingDTOPrivateWatermarkResponse

  @WalnutAdminDecoratorFieldObject(AppSettingDTOPrivateTransitionResponse, {
    swaggerOptions: {
      title: 'transition switch',
    },
  })
  transition: AppSettingDTOPrivateTransitionResponse
}

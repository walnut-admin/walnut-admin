import { ApiProperty } from '@nestjs/swagger'
import { IWalnutAdminConstDecoratorLogAuthType, WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@walnut-server/list'
import { RealOmitType, RealPartialType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/log.auth.schema.ts 的 SysLogAuthModel
// 改名 SysLogAuthDTOBase），装饰器与字段本体零改动
export class SysLogAuthDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'ip address when auth',
    },
    validateOptions: {
      ip: true,
    },
  })
  ip: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'location when auth',
    },
  })
  location: string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'operating system when auth',
    },
  })
  os: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'browser when auth',
    },
  })
  browser: string

  @Expose()
  // B8 迁 PG（phase2 4.15）：user_id 松引用收 uuid —— uuid 校验在 DTO 子类重声明接管
  // （下方模板），本基座的 Mongo 装饰器仅作为 DTO 元数据保留
  // （模型注册已随迁移从 log.auth.module 摘除，@Prop 不再有运行时语义）
  userId: string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'user name when auth',
    },
  })
  userName: string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'identifier when auth, e.g. email, phone number',
    },
  })
  identifier: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'auth success or not',
    },
  })
  success: boolean

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'messages returned when auth',
    },
  })
  msg: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogAuthType, {
    default: null,
    swaggerOptions: {
      title: 'auth type',
      example: WalnutAdminConstDecoratorLogAuthType.OPAQUE,
    },
  })
  type: IWalnutAdminConstDecoratorLogAuthType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'authenticate device id' },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'authenticatedAt, also known as createdAt',
      required: false,
    },
  })
  authenticatedAt?: Date
}

export class SysLogAuthDTO extends SysLogAuthDTOBase {
  constructor(partial: Partial<SysLogAuthDTO>) {
    super()
    Object.assign(this, partial)
  }

  // B1 模板：PG 主键 id（uuid，phase2 4.15）—— @Expose 供响应序列化
  // （ClassSerializerInterceptor excludeExtraneousValues 只放行 Expose 字段）与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // B1 模板（IsMongoId → IsUUID）：子类重声明同名字段，class-validator 按
  // propertyName+type 去重、子类约束整体替换继承的 IsMongoId；松引用列可空
  // （登录失败时 NULL，phase2 4.15），nullable 与列型对齐
  @Expose()
  @ApiProperty({
    type: String,
    default: null,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  declare userId: string | null
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysLogAuthDTOSafe extends SysLogAuthDTO {
  constructor(partial?: Partial<SysLogAuthDTOSafe>) {
    super(partial ?? {})
  }
}

class SysLogAuthDTOSafeRequest extends RealPartialType(RealOmitType(SysLogAuthDTOSafe, ['type'] as const)) {
  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogAuthType, {
    isArray: true,
    swaggerOptions: {
      title: 'auth type for request query, support array',
      example: WalnutAdminConstDecoratorLogAuthType.OPAQUE,
    },
  })
  @IsOptional({ each: true })
  type: IWalnutAdminConstDecoratorLogAuthType

  @WalnutAdminDecoratorFieldDate({
    isArray: true,
    swaggerOptions: {
      title: 'authenticatedAt for request query, support array',
      required: false,
    },
  })
  authenticatedAt: Date
}

// list
// L2 sort 白名单：admin 登录日志排 userName/success/type/authenticatedAt
// （views/system/log/auth 四列 sorter，authenticatedAt 为 defaultSortOrder descend，
// 有 idx_log_auth_at DESC）；userName/success/type 无索引但 admin 在用 → 保留，
// 见报告建议补索引。实体只有 authenticated_at 一个时间列，无 createdAt/updatedAt
export class SysLogAuthDTOListRequest extends CreateWalnutAdminRequestListDTO(SysLogAuthDTOSafeRequest, {
  sortOnlyIn: ['userName', 'success', 'type', 'authenticatedAt'],
}) { }

export class SysLogAuthDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysLogAuthDTOSafe),
) { }

// delete
export class SysLogAuthDTODeleteResponse extends SysLogAuthDTOSafe { }

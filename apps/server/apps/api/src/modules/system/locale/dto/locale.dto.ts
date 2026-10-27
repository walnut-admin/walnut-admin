import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { LocaleLangIdValidate } from '../locale.validate'
import { SysLocaleModel } from '../schema/locale.schema'

export class SysLocaleDTO extends SysLocaleModel {
  constructor(partial: Partial<SysLocaleDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.5）：B1 模板 —— @Expose 供响应序列化
  // （ClassSerializerInterceptor excludeExtraneousValues 只放行 Expose 字段）与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // IsMongoId → IsUUID 模板（B1 确立）：在 DTO 子类重声明同名字段整体替换继承的
  // IsMongoId 约束；langId 原有的业务校验（缓存 lang id 白名单）经 options.validate 保留
  @Expose()
  @ApiProperty({
    type: String,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid({ validate: LocaleLangIdValidate })
  declare langId: string
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysLocaleDTOSafe extends SysLocaleDTO {
  constructor(partial?: Partial<SysLocaleDTOSafe>) {
    super(partial ?? {})
  }

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'translate process',
    },
    transformOptions: {
      res: {
        precision: 2,
      },
    },
  })
  process: number
}

// list
export class SysLocaleDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysLocaleDTOSafe),
) {}

export class SysLocaleDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(
    RealPickType(SysLocaleDTOSafe, [
      'id',
      'key',
      'process',
      'createdAt',
      'updatedAt',
    ] as const),
  ),
) {}

// create
export class SysLocaleDTOCreateRequest extends IntersectionType(
  RealPickType(SysLocaleDTOSafe, [
    'langId',
    'key',
  ] as const),
  RealPartialType(RealPickType(SysLocaleDTOSafe, [
    'value',
  ] as const)),
) {}
export class SysLocaleDTOCreateResponse extends SysLocaleDTOSafe {}

// update
export class SysLocaleDTOUpdateRequest extends IntersectionType(
  RealPickType(SysLocaleDTOSafe, [
    'langId',
    'key',
  ] as const),
  RealPartialType(RealPickType(SysLocaleDTOSafe, [
    'value',
  ] as const)),
) {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'old key, used for to find in the db',
    },
  })
  oldKey: string
}
export class SysLocaleDTOUpdateResponse extends SysLocaleDTOSafe {}

// delete
export class SysLocaleDTODeleteResponse extends SysLocaleDTOSafe {}

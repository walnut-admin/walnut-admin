import { ApiProperty } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldNumber } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysLangModel } from '../schema/lang.schema'

export class SysLangDTO extends SysLangModel {
  constructor(partial: Partial<SysLangDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.4）：B1 模板 —— @Expose 供响应序列化
  // （ClassSerializerInterceptor excludeExtraneousValues 只放行 Expose 字段）与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysLangDTOSafe extends SysLangDTO {
  constructor(partial?: Partial<SysLangDTOSafe>) {
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
export class SysLangDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysLangDTOSafe),
) { }

export class SysLangDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysLangDTOSafe),
) { }

// create
export class SysLangDTOCreateRequest extends RealPickType(SysLangDTOSafe, [
  'lang',
  'description',
  'order',
  'status',
] as const) { }
export class SysLangDTOCreateResponse extends SysLangDTOSafe { }

// read
export class SysLangDTOReadResponse extends SysLangDTOSafe { }

// update
export class SysLangDTOUpdateRequest extends RealPickType(SysLangDTOSafe, [
  'lang',
  'description',
  'order',
  'status',
] as const) { }
export class SysLangDTOUpdateResponse extends SysLangDTOSafe { }

// delete
export class SysLangDTODeleteResponse extends SysLangDTOSafe { }

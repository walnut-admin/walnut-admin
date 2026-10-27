import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldEnum } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysDictDataTagTypeConst, SysDictDataTagTypeConstType } from '../dict-data.const'
import { SysDictDataModel } from '../schema/dictData.schema'

export class SysDictDataDTO extends SysDictDataModel {
  constructor(partial?: Partial<SysDictDataDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.7）：B1 模板 —— @Expose 供响应序列化
  // （ClassSerializerInterceptor excludeExtraneousValues 只放行 Expose 字段）与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // IsMongoId → IsUUID 模板（B1 确立）：在 DTO 子类重声明同名字段整体替换继承的
  // IsMongoId 约束（typeId → sys_dict_type 的 uuid FK，phase2 4.7）
  @Expose()
  @ApiProperty({
    type: String,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid()
  declare typeId: string
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysDictDataDTOSafe extends SysDictDataDTO {
  constructor(partial?: Partial<SysDictDataDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

class SysDictDataDTOSafeRequest extends RealPartialType(RealOmitType(SysDictDataDTOSafe, ['tagType'] as const)) {
  @WalnutAdminDecoratorFieldEnum(() => SysDictDataTagTypeConst, {
    isArray: true,
    default: SysDictDataTagTypeConst.PRIMARY,
    swaggerOptions: {
      title: 'dict data render tag type, see more in naive ui tag',
    },
  })
  @IsOptional({ each: true })
  tagType: SysDictDataTagTypeConstType
}

// list
export class SysDictDataDTOListRequest extends CreateWalnutAdminRequestListDTO(
  SysDictDataDTOSafeRequest,
) { }

export class SysDictDataDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysDictDataDTOSafe),
) { }

// create
export class SysDictDataDTOCreateRequest extends IntersectionType(RealPickType(
  SysDictDataDTOSafe,
  [
    'typeId',
    'label',
    'value',
    'tagType',
    'order',
    'status',
  ] as const,
), RealPartialType(RealPickType(SysDictDataDTOSafe, ['description'] as const))) { }
export class SysDictDataDTOCreateResponse extends SysDictDataDTOSafe { }

// read
export class SysDictDataDTOReadResponse extends SysDictDataDTOSafe { }

// update
export class SysDictDataDTOUpdateRequest extends IntersectionType(RealPickType(
  SysDictDataDTOSafe,
  [
    'typeId',
    'label',
    'value',
    'tagType',
    'order',
    'status',
  ] as const,
), RealPartialType(RealPickType(SysDictDataDTOSafe, ['description'] as const))) { }
export class SysDictDataDTOUpdateResponse extends SysDictDataDTOSafe { }

// delete
export class SysDictDataDTODeleteResponse extends SysDictDataDTOSafe { }

export class SysDictDataDTOPopulatedDictData extends RealPickType(SysDictDataDTOSafe, [
  'value',
  'label',
  'tagType',
  'order',
  'id',
] as const) {
  constructor(partial?: Partial<SysDictDataDTOPopulatedDictData>) {
    super()
    Object.assign(this, partial)
  }
}

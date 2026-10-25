import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysDictDataDTOPopulatedDictData } from '../../dictData/dto/dictData.dto'
import { SysDictTypeModel } from '../schema/dictType.schema'

export class SysDictTypeDTO extends SysDictTypeModel {
  constructor(partial?: Partial<SysDictTypeDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.6）：B1 模板 —— @Expose 供响应序列化
  // （ClassSerializerInterceptor excludeExtraneousValues 只放行 Expose 字段）与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string
}

// Safe 层剔除 Mongo 的 _id（B1 模板：PG 响应以 id 为唯一标识，_id 在 PG 实体上不存在）
export class SysDictTypeDTOSafe extends RealOmitType(
  SysDictTypeDTO,
  ['_id'] as const,
) {
  constructor(partial?: Partial<SysDictTypeDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

// list
export class SysDictTypeDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysDictTypeDTOSafe),
) { }

export class SysDictTypeDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysDictTypeDTOSafe),
) { }

// create
export class SysDictTypeDTOCreateRequest extends IntersectionType(RealPickType(
  SysDictTypeDTOSafe,
  ['type', 'name', 'status'] as const,
), RealPartialType(RealPickType(
  SysDictTypeDTOSafe,
  ['description'] as const,
))) { }
export class SysDictTypeDTOCreateResponse extends SysDictTypeDTOSafe { }

// read
export class SysDictTypeDTOReadResponse extends SysDictTypeDTOSafe { }

// update
export class SysDictTypeDTOUpdateRequest extends IntersectionType(RealPickType(
  SysDictTypeDTOSafe,
  ['type', 'name', 'status'] as const,
), RealPartialType(RealPickType(
  SysDictTypeDTOSafe,
  ['description'] as const,
))) { }
export class SysDictTypeDTOUpdateResponse extends SysDictTypeDTOSafe { }

// delete
export class SysDictTypeDTODeleteResponse extends SysDictTypeDTOSafe { }

// get by type
export class SysDictTypeDTOWithDictDataResponse extends RealPickType(
  SysDictTypeDTOSafe,
  ['type', 'name'] as const,
) {
  constructor(partial?: Partial<SysDictTypeDTOWithDictDataResponse>) {
    super()
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysDictDataDTOPopulatedDictData, {
    isArray: true,
    swaggerOptions: {
      title: 'dict data with dict type',
    },
  })
  dictData: SysDictDataDTOPopulatedDictData[]
}

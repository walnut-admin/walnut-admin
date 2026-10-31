import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@walnut-server/list'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { SysDictDataDTOPopulatedDictData } from '../../dictData/dto/dictData.dto'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/dictType.schema.ts 的 SysDictTypeModel
// 改名 SysDictTypeDTOBase），装饰器与字段本体零改动
//
// B3 迁移后基座仅作为 DTO 元数据保留（模型注册已随迁移从 dictType.module 摘除，
// @Prop/@Virtual 不再有运行时语义）；PG 列型见 entity/dict-type.entity.ts，
// dictData / dictDataCount 两个 virtual 在 PG 侧改为相关子查询
// （dictType.basic.repository 的 list 覆写 / getByType 的两次取数）。
export class SysDictTypeDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict name',
      required: true,
    },
  })
  name: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict type or can be treated as dict key',
      required: true,
    },
  })
  type: string

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'dict status',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'description',
    },
  })
  description: string

  // virtual（P3-16）：PG list 行只注入 dictDataCount，dictData 恒缺失（Mongo 时代
  // $lookup 的残留）；read / create / update 两条腿两个键都不带。swagger 一律
  // optional —— 此前 dictData 被标成 required 的单对象，与 wire 相反。
  @WalnutAdminDecoratorFieldObject(SysDictDataDTOPopulatedDictData, {
    swaggerOptions: {
      required: false,
      title: 'populated dict data',
    },
  })
  dictData?: SysDictDataDTOPopulatedDictData

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      required: false,
      title: `populated dict data count`,
    },
  })
  dictDataCount?: number
}

export class SysDictTypeDTO extends SysDictTypeDTOBase {
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

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysDictTypeDTOSafe extends SysDictTypeDTO {
  constructor(partial?: Partial<SysDictTypeDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

// list
// L2 sort 白名单：admin dict 列表排 status/createdAt/updatedAt（views/system/dict
// index.vue 三个 preset 列）。createdAt 有 idx_dict_type_created_at DESC；status 无
// 索引但 admin 在用 → 保留，见报告建议补索引
export class SysDictTypeDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysDictTypeDTOSafe),
  { sortOnlyIn: ['status', 'createdAt', 'updatedAt'] },
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

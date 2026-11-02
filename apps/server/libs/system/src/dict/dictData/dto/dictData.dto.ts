import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { WalnutAdminCommonBasicModel } from '@walnut-server/identity'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@walnut-server/list'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { SysDictDataTagTypeConst, SysDictDataTagTypeConstType } from '../dict-data.const'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/dictData.schema.ts 的 SysDictDataModel
// 改名 SysDictDataDTOBase），装饰器与字段本体零改动
//
// B3 迁移后基座仅作为 DTO 元数据保留（模型注册已随迁移从 dictData.module /
// dictType.module 摘除，@Prop 不再有运行时语义）；PG 列型见 entity/dict-data.entity.ts。
export class SysDictDataDTOBase extends WalnutAdminCommonBasicModel {
  @Expose()
  // B3：TS 类型随 PG 列型放开为 string（uuid FK，phase2 4.7），uuid 校验在 DTO 子类接管
  typeId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict data label',
      required: true,
    },
  })
  label: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict data value',
      required: true,
    },
  })
  value: string

  @WalnutAdminDecoratorFieldNumber({
    default: 0,
    swaggerOptions: {
      title: 'dict data order in array',
    },
    validateOptions: {
      int: true,
    },
  })
  order: number

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'dict data status, false will not be extracted',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldEnum(() => SysDictDataTagTypeConst, {
    default: SysDictDataTagTypeConst.PRIMARY,
    swaggerOptions: {
      title: 'dict data render tag type, see more in naive ui tag',
    },
  })
  tagType: SysDictDataTagTypeConstType

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'dict data description',
    },
  })
  description: string
}

export class SysDictDataDTO extends SysDictDataDTOBase {
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
// L2 sort 白名单：admin dict 详情页排 order/status/createdAt/updatedAt
// （views/system/dict/detail.vue 四个 preset 列）。order → sort_order，有
// idx_dict_data_type_order (type_id, sort_order) 支撑（详情列表恒带 typeId 过滤）；
// status 无索引但 admin 在用 → 保留，见报告建议补索引
export class SysDictDataDTOListRequest extends CreateWalnutAdminRequestListDTO(
  SysDictDataDTOSafeRequest,
  { sortOnlyIn: ['order', 'status', 'createdAt', 'updatedAt'] },
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

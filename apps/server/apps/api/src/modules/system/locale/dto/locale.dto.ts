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
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { LocaleLangIdValidate } from '../locale.validate'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/locale.schema.ts 的 SysLocaleModel
// 改名 SysLocaleDTOBase），装饰器与字段本体零改动
//
// B2 迁移后基座仅作为 DTO 元数据保留（模型注册已随迁移从 locale.module /
// locale.repo.module / locale.shared.module 摘除，@Prop 不再有运行时语义）；
// PG 列型见 entity/locale.entity.ts —— langId 由 ObjectId 放开为 uuid 字符串
// （phase2 4.5），uuid 校验在 DTO 子类重声明接管。
export class SysLocaleDTOBase extends WalnutAdminCommonBasicModel {
  @Expose()
  // B2：TS 类型随 PG 列型放开为 string（uuid），校验在 DTO 子类接管
  langId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      required: true,
      title: 'i18n key',
    },
  })
  key: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'i18n value',
    },
    validateOptions: {
      nullable: true,
    },
  })
  value: string
}

export class SysLocaleDTO extends SysLocaleDTOBase {
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

  // 列表分组行加工列（P3-10）：locale.repo.service.aggregateList 注入
  // MAX(finished) / langsCount（0..1 小数，admin 列表乘 100 展示），wire 上只出现在
  // list 行。声明在基类而非 Safe 层：CRUD list 装饰器用 SysLocaleDTO 作为 data items
  // 的文档真源（Safe 层不进 schema）。
  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      required: false,
      title: 'translate process',
      description: 'fraction (0-1) of finished translations for the key (admin displays × 100)',
    },
    transformOptions: {
      res: {
        precision: 2,
      },
    },
  })
  process?: number
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysLocaleDTOSafe extends SysLocaleDTO {
  constructor(partial?: Partial<SysLocaleDTOSafe>) {
    super(partial ?? {})
  }
}

// list
// L2 sort 白名单：与 locale.repo.service aggregateList 的 SORT_ALIAS_MAP 对齐
// （key/process/createdAt/updatedAt 可落 SQL ORDER BY）；admin locale 列表排 key +
// process（defaultSortOrder descend）。key 有 idx_locale_key（btree+gin trgm）；
// id 在 SORT_MAP 里只是 key 的别名，admin 不用，不收
export class SysLocaleDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysLocaleDTOSafe),
  { sortOnlyIn: ['key', 'process', 'createdAt', 'updatedAt'] },
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

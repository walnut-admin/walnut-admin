import { ApiProperty } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { LocaleType } from '@walnut/contract'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/lang.schema.ts 的 SysLangModel
// 改名 SysLangDTOBase），装饰器与字段本体零改动
//
// B2 迁移后基座仅作为 DTO 元数据保留（模型注册已随迁移从 lang.module /
// lang.repo.module 摘除，@Prop/@Virtual 不再有运行时语义）；PG 列型见 entity/lang.entity.ts，
// 两个 locale 计数 virtual 在 PG 侧改为相关子查询（repo 层，phase2 5.2）。
export class SysLangDTOBase extends WalnutAdminCommonBasicModel {
  /**
   * @description how to remove indexes in mongodb
   * @link https://stackoverflow.com/questions/12337388/mongodb-remove-unique-constraint
   */
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'language short',
    },
  })
  lang: LocaleType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'language describe',
    },
  })
  description: string

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'language order',
      description: 'should be int',
    },
    validateOptions: { int: true },
  })
  order: number

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'language is in use or not',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `current lang's locales total count`,
    },
  })
  localesTotalCount: number

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `current lang's locales finished count`,
    },
  })
  localesFinishedCount: number
}

export class SysLangDTO extends SysLangDTOBase {
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

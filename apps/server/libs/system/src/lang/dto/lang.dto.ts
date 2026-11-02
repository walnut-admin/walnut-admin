import { ApiProperty } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { WalnutAdminCommonBasicModel } from '@walnut-server/identity'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@walnut-server/list'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { LocaleType } from '@walnut/contract'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'

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

  // 列表行加工列（P3-10）：lang.basic.repository 的 PG list 覆写注入
  // finished / total * 100；wire 上只出现在 list 行。零 locale 的 lang 在 JS 侧
  // 除法得 NaN，JSON 序列化为 null —— 故 nullable。声明在基类而非 Safe 层：
  // CRUD list 装饰器用 SysLangDTO 作为 data items 的文档真源（Safe 层不进 schema）。
  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      required: false,
      nullable: true,
      title: 'translate process',
      description: 'percentage (0-100); null when the lang has zero locales (NaN → null)',
    },
    transformOptions: {
      res: {
        precision: 2,
      },
    },
  })
  process?: number | null
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysLangDTOSafe extends SysLangDTO {
  constructor(partial?: Partial<SysLangDTOSafe>) {
    super(partial ?? {})
  }
}

// list
// L2 sort 白名单：admin lang 列表排 order（defaultSortOrder ascend）/status/
// createdAt/updatedAt（views/system/lang 四个 preset 列）。order → sort_order 列，
// sys_lang 无独立业务索引（仅 uq_lang）——admin 在用，保留，见报告建议补索引
export class SysLangDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysLangDTOSafe),
  { sortOnlyIn: ['order', 'status', 'createdAt', 'updatedAt'] },
) { }

export class SysLangDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysLangDTOSafe),
) { }

/**
 * `GET /system/lang/list/public` 行形态 —— repo `findPublic()` 的三列 raw 投影
 * （order / lang / description），无 id / status / 计数列。仅文档化，wire 不变。
 */
export class SysLangDTOListPublicResponse {
  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'language order',
      description: 'should be int',
    },
  })
  order: number

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
}

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

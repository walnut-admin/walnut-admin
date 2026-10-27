import { ApiProperty } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { ValueOf } from 'easy-fns-ts'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/demo.schema.ts，改名的 DemoConst /
// DemoObject 等私有辅助随基座类一并搬入），装饰器与字段本体零改动

const DemoConst = {
  TYPE1: 1,
  TYPE2: 2,
  TYPE3: 3,
  TYPE4: 4,
} as const

type DemoConstType = ValueOf<typeof DemoConst>

class DemoObject {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: 'this is an example',
    },
    validateOptions: {
      upper: true,
    },
  })
  o1: string

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: 123,
    },
    validateOptions: {
      int: true,
    },
  })
  o2: number

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: true,
    },
  })
  o3: boolean
}

export class AppDemoDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: 'this is an example',
    },
    validateOptions: {
      upper: true,
    },
    transformOptions: { req: { trim: true }, res: { lower: true } },
  })
  // unique: true => collection index
  demoString: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: 'this is an example',
    },
    validateOptions: {
      // TODO too strict
      // phoneNumber: true,
    },
    transformOptions: { req: { trim: true }, res: { phoneNumberMask: true } },
  })
  // unique: true => collection index
  demoPhoneNumber: string

  @WalnutAdminDecoratorFieldString({
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
      contains: ['1'],
      notContains: ['2'],
      unique: true,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: [
        'this is an example',
        'this is an example',
        'this is an example',
      ],
    },
    validateOptions: {
      lower: true,
    },
    transformOptions: {
      res: { upper: true },
    },
  })
  demoStringArray: string[]

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: 123,
    },
    // 迁移回归修复（API 回归 A 段试点抓出）：precision: 4 是 Mongo 时代遗留
    // （IsPrecisionRight 要求小数部分恰好 4 位），而 phase2 已把 demo_number 列定稿为
    // integer —— 整数过不了校验、带小数过不了 PG 落库，create/update 无任何可用负载。
    // 按列型定稿改为 int 校验（base-repo int-spec 同一口径）。
    validateOptions: {
      int: true,
    },
    transformOptions: {
      res: {
        precision: 2,
        round: true,
      },
    },
  })
  demoNumber: number

  @WalnutAdminDecoratorFieldNumber({
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
      contains: [-1],
      notContains: [-2],
      unique: true,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: [123, 123, 123],
    },
    validateOptions: {
      positive: false,
    },
  })
  demoNumberArray: number[]

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: true,
    },
  })
  demoBoolean: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: [true, false, true],
    },
  })
  demoBooleanArray: boolean[]

  @WalnutAdminDecoratorFieldDate({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: '2023-11-11 00:00:00',
    },
  })
  demoDate: Date

  @WalnutAdminDecoratorFieldDate({
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
      unique: true,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: [
        '2023-11-11 00:00:00',
        '2023-11-11 00:00:00',
        '2023-11-11 00:00:00',
      ],
    },
  })
  demoDateArray: Date[]

  @WalnutAdminDecoratorFieldEnum(() => DemoConst, {
    default: DemoConst.TYPE1,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: DemoConst.TYPE1,
    },
  })
  demoEnum: DemoConstType

  @WalnutAdminDecoratorFieldEnum(() => DemoConst, {
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
      unique: true,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: [DemoConst.TYPE1, DemoConst.TYPE2],
    },
  })
  demoEnumArray: DemoConstType[]

  @Expose()
  // B1 迁 PG（phase2 4.20 demo_uuid）：属性 TS 类型随列型放开为 string；uuid 校验在
  // DTO 子类重声明接管（下方模板），本基座的 Mongo 装饰器仅作为 DTO 元数据保留
  // （模型注册已随迁移从 demo.module 摘除，@Prop 不再有运行时语义）
  demoMongoId: string

  @Expose()
  demoMongoIdArray: string[]

  @WalnutAdminDecoratorFieldObject(DemoObject, {
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: {
        o1: 'this is an example',
        o2: 123,
        o3: true,
      },
    },

  })
  demoObject: {
    o1: string
    o2: number
    o3: boolean
  }
}

export class AppDemoDTO extends AppDemoDTOBase {
  constructor(partial: Partial<AppDemoDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.20）：PG 实体是 POJO 无元数据，在 DTO 链头部补声明 ——
  // @Expose 供响应序列化（ClassSerializerInterceptor excludeExtraneousValues 只放行
  // Expose 字段，缺了它响应不带 id）与 RealPickType/RealPartialType 的键枚举；
  // 入参不从这里进（主键只走路由参数的 uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // IsMongoId → IsUUID 模板（B1 确立）：在 DTO 子类重声明同名字段，class-validator
  // 按 propertyName+type 去重、子类约束整体替换继承的 IsMongoId（实测 0.15 行为），
  // swagger 示例同步换 uuid。declare 只免代码生成（不产生运行时字段），类型与
  // 基座注解（随 PG 列型放开为 string）保持一致
  @Expose()
  @ApiProperty({
    type: String,
    default: null,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid()
  declare demoMongoId: string

  // 同上，数组形态（arrayOptions 照抄基座原契约）
  @Expose()
  @ApiProperty({
    type: String,
    isArray: true,
    default: [],
    maxItems: 3,
    minItems: 1,
    example: ['0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c'],
  })
  @WalnutAdminDecoratorValidatorUuid(undefined, true, { minSize: 1, maxSize: 3, unique: true })
  declare demoMongoIdArray: string[]
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class AppDemoDTOSafe extends AppDemoDTO {
  constructor(partial: Partial<AppDemoDTOSafe>) {
    super(partial)
  }
}

// list
export class AppDemoDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(AppDemoDTOSafe),
) {}

export class AppDemoDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(AppDemoDTOSafe),
) {}

// create
// （A 段试点补齐：phase2 4.20 把数组列定稿 NOT NULL 且「应用侧必须显式给值」，但
// create/update 的 pick 漏了全部数组字段 —— HTTP create 必撞 demo_string_array NOT NULL，
// 迁移回归由 API 回归抓出后按列型定稿补上；数组校验自带 minSize: 1，显式给值即非空）
export class AppDemoDTOCreateRequest extends RealPickType(AppDemoDTOSafe, [
  'demoString',
  'demoPhoneNumber',
  'demoNumber',
  'demoBoolean',
  'demoDate',
  'demoEnum',
  'demoMongoId',
  'demoObject',
  'demoStringArray',
  'demoNumberArray',
  'demoBooleanArray',
  'demoDateArray',
  'demoEnumArray',
  'demoMongoIdArray',
] as const) {}
export class AppDemoDTOCreateResponse extends AppDemoDTOSafe {}

// read
export class AppDemoDTOReadResponse extends AppDemoDTOSafe {}

// update
export class AppDemoDTOUpdateRequest extends RealPickType(AppDemoDTOSafe, [
  'demoString',
  'demoPhoneNumber',
  'demoNumber',
  'demoBoolean',
  'demoDate',
  'demoEnum',
  'demoMongoId',
  'demoObject',
  'demoStringArray',
  'demoNumberArray',
  'demoBooleanArray',
  'demoDateArray',
  'demoEnumArray',
  'demoMongoIdArray',
] as const) {}
export class AppDemoDTOUpdateResponse extends AppDemoDTOSafe {}

// delete
export class AppDemoDTODeleteResponse extends AppDemoDTOSafe {}

import { ApiProperty } from '@nestjs/swagger'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { AppDemoModel } from '../schema/demo.schema'

export class AppDemoDTO extends AppDemoModel {
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
  // schema 注解（随 PG 列型放开为 string）保持一致
  @Expose()
  @ApiProperty({
    type: String,
    default: null,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid()
  declare demoMongoId: string

  // 同上，数组形态（arrayOptions 照抄 schema 原契约）
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

// Safe 层剔除 Mongo 的 _id（B1 模板：PG 响应以 id 为唯一标识，_id 在 PG 实体上不存在）
export class AppDemoDTOSafe extends RealOmitType(AppDemoDTO, ['_id'] as const) {
  constructor(partial: Partial<AppDemoDTOSafe>) {
    super()
    Object.assign(this, partial)
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

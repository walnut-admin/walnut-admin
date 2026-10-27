import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { WalnutAdminVirtualRolesCountDTO, WalnutAdminVirtualRolesListDTO } from '@/common/model/virtual/role'
import { SysUserModel } from '../schema/user.schema'

// do not use when need to extend
// use `SysUserDTOSafe` below to extend
export class SysUserDTO extends IntersectionType(SysUserModel, WalnutAdminVirtualRolesCountDTO, WalnutAdminVirtualRolesListDTO) {
  constructor(partial?: Partial<SysUserDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.1）：PG 实体是 POJO 无元数据，在 DTO 链头部补声明 ——
  // @Expose 供响应序列化（ClassSerializerInterceptor excludeExtraneousValues 只放行
  // Expose 字段，缺了它响应不带 id）与 RealPickType/RealPartialType 的键枚举；
  // 入参不从这里进（主键只走路由参数的 uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // IsMongoId → IsUUID 模板（B1 确立）：在 DTO 子类重声明同名字段，class-validator
  // 按 propertyName+type 去重、子类约束整体替换继承的 IsMongoId。roles 原 ObjectId[]
  // → junction 承接的 uuid 数组（数组内去重对齐 schema arrayOptions.unique）
  @Expose()
  @ApiProperty({
    type: String,
    isArray: true,
    default: [],
    example: ['0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c'],
  })
  @WalnutAdminDecoratorValidatorUuid(undefined, true, { unique: true })
  declare roles: string[]

  // user's current role id：ObjectId → uuid
  @Expose()
  @ApiProperty({
    type: String,
    nullable: true,
    default: null,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  declare currentRole: string | null
}

// safe dto without sensitive fields
// （Safe 层曾是「剔除 Mongo `_id`」的派生（B7a/B1 模板）；_id 已随 PG 迁移退役，现仅存名）
export class SysUserDTOSafe extends SysUserDTO {
  constructor(partial?: Partial<SysUserDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

// list
export class SysUserDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysUserDTOSafe),
) {}

export class SysUserDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPickType(RealPartialType(SysUserDTOSafe), ['id', 'userName', 'nickName', 'status', 'createdAt', 'updatedAt', 'populated_roles_count'] as const),
) {
  constructor(partial?: Partial<SysUserDTOListResponse>) {
    super()
    Object.assign(this, partial)
  }
}

// create
export class SysUserDTOCreateRequest extends RealPickType(SysUserDTOSafe, [
  'userName',
  'status',
  'roles',
] as const) {}
export class SysUserDTOCreateResponse extends SysUserDTOSafe {}

// read
export class SysUserDTOReadResponse extends SysUserDTOSafe {}

// update
export class SysUserDTOUpdateRequest extends RealPickType(SysUserDTOSafe, [
  'userName',
  'status',
  'roles',
] as const) {}
export class SysUserDTOUpdateResponse extends SysUserDTOSafe {}

// delete
export class SysUserDTODeleteResponse extends SysUserDTOSafe {}

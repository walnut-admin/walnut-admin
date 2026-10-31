import { ApiProperty, IntersectionType } from '@nestjs/swagger'

import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { SysUserDTOBase } from '@walnut-server/identity'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@walnut-server/list'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { WalnutAdminVirtualRolesCountDTO, WalnutAdminVirtualRolesListDTO } from '@/common/model/virtual/role'

/**
 * user 的字段基座随身份内核下沉 libs/identity（批 6）；本文件保留 wire 响应面
 * （role 读模型组合），class 名与 schema 名不变。
 */
// do not use when need to extend
// use `SysUserDTOSafe` below to extend
export class SysUserDTO extends IntersectionType(SysUserDTOBase, WalnutAdminVirtualRolesCountDTO, WalnutAdminVirtualRolesListDTO) {
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
  // → junction 承接的 uuid 数组（数组内去重对齐基座 arrayOptions.unique 的业务语义）
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
// L2 sort 白名单：admin user 列表排 status/createdAt/updatedAt（views/system/user
// 三个 preset 列，updatedAt 为 defaultSortOrder descend）。createdAt 有
// idx_user_created_at DESC；status 无索引但 admin 在用 → 保留，见报告建议补索引
export class SysUserDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysUserDTOSafe),
  { sortOnlyIn: ['status', 'createdAt', 'updatedAt'] },
) {}

export class SysUserDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPickType(RealPartialType(SysUserDTOSafe), ['id', 'userName', 'nickName', 'status', 'createdAt', 'updatedAt', 'roles_count'] as const),
) {
  constructor(partial?: Partial<SysUserDTOListResponse>) {
    super()
    Object.assign(this, partial)
  }
}

// create
// 批 2：deptId 可选（admin 用户表单同一棵树选择器；create 直接写 sys_user.dept_id，
// 便于建号即归部门 —— 与 update 的 deptId 分支同口径）
export class SysUserDTOCreateRequest extends IntersectionType(
  RealPickType(SysUserDTOSafe, [
    'userName',
    'status',
    'roles',
  ] as const),
  RealPartialType(RealPickType(SysUserDTOSafe, ['deptId'] as const)),
) {}
export class SysUserDTOCreateResponse extends SysUserDTOSafe {}

// read
export class SysUserDTOReadResponse extends SysUserDTOSafe {}

// update
export class SysUserDTOUpdateRequest extends IntersectionType(
  RealPickType(SysUserDTOSafe, [
    'userName',
    'status',
    'roles',
  ] as const),
  // 部门可省略（语义：不修改）；显式给值（含 null）才触发数据权限缓存失效
  RealPartialType(RealPickType(SysUserDTOSafe, ['deptId'] as const)),
) {}
export class SysUserDTOUpdateResponse extends SysUserDTOSafe {}

// delete
export class SysUserDTODeleteResponse extends SysUserDTOSafe {}

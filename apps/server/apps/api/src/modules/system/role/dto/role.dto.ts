import { ApiProperty, IntersectionType } from '@nestjs/swagger'

import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysRoleModel } from '../schema/role.schema'

export class SysRoleDTO extends SysRoleModel {
  constructor(partial?: Partial<SysRoleDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.2）：B1 模板 —— @Expose 供响应序列化
  // （ClassSerializerInterceptor excludeExtraneousValues 只放行 Expose 字段）与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // IsMongoId → IsUUID 模板（B1 确立）：menus 原为 ObjectId[]，PG 侧是
  // sys_role_menu 关联表的 menu_id uuid 集合（写入与读出都保持 uuid 数组形态，
  // 响应字段名与 Mongo 版一致）。unique 对齐 Mongo 版数组的业务入参语义
  // （junction 复合 PK 去重，phase2 4.2 勘误不保留 multikey 语义）
  @Expose()
  @ApiProperty({
    type: String,
    isArray: true,
    default: [],
    example: ['0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c'],
  })
  @WalnutAdminDecoratorValidatorUuid(undefined, true, { unique: true })
  declare menus: string[]
}

// Safe 层剔除 Mongo 的 _id（B1 模板：PG 响应以 id 为唯一标识，_id 在 PG 实体上不存在）
export class SysRoleDTOSafe extends RealOmitType(SysRoleDTO, ['_id'] as const) {
  constructor(partial?: Partial<SysRoleDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysRoleDTOSafeWithoutMenus extends RealOmitType(SysRoleDTOSafe, [
  'menus',
] as const) {
  constructor(partial: Partial<SysRoleDTOSafeWithoutMenus>) {
    super()
    Object.assign(this, partial)
  }
}

// list
export class SysRoleDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysRoleDTOSafe),
) {}

export class SysRoleDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysRoleDTOSafeWithoutMenus),
) {}

// create
export class SysRoleDTOCreateRequest extends IntersectionType(
  RealPickType(SysRoleDTOSafe, [
    'roleName',
    'description',
    'order',
    'status',
  ] as const),
  RealPartialType(RealPickType(SysRoleDTOSafe, ['menus'] as const)),
) {}
export class SysRoleDTOCreateResponse extends SysRoleDTOSafe {}

// read
export class SysRoleDTOReadResponse extends SysRoleDTOSafe {}

// update
export class SysRoleDTOUpdateRequest extends IntersectionType(
  RealPickType(SysRoleDTOSafe, [
    'roleName',
    'description',
    'order',
    'status',
  ] as const),
  RealPartialType(RealPickType(SysRoleDTOSafe, ['menus'] as const)),
) {}
export class SysRoleDTOUpdateResponse extends SysRoleDTOSafe {}

// delete
export class SysRoleDTODeleteResponse extends SysRoleDTOSafe {}

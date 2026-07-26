import { IntersectionType } from '@nestjs/swagger'

import { RealOmitType, RealPartialType, RealPickType } from '@walnut/utils/dto'
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
}

export class SysRoleDTOSafe extends RealOmitType(SysRoleDTO, [] as const) {
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

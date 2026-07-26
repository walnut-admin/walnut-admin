import { IntersectionType } from '@nestjs/swagger'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut/utils/dto'
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
}

// safe dto without sensitive fields
export class SysUserDTOSafe extends RealOmitType(SysUserDTO, [] as const) {
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
  RealPickType(RealPartialType(SysUserDTOSafe), ['_id', 'userName', 'nickName', 'status', 'createdAt', 'updatedAt', 'populated_roles_count'] as const),
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

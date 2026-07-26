import { WalnutDBModelName, WalnutDBVirtualName } from '@walnut-server/db'
import { WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field'

import { Schema } from 'mongoose'
import { SysRoleDTOSafe } from '@/modules/system/role/dto/role.dto'
import { ISysRoleDocument } from '@/modules/system/role/schema/role.schema'
import { addVirtual } from '../virtual'

export function addVirtualRolesList(schema: Schema) {
  return addVirtual(schema, {
    virtualPath: WalnutDBVirtualName.ROLES_LIST,
    ref: WalnutDBModelName.SYS_ROLE,
    localField: 'roles',
    foreignField: '_id',
  })
}

export interface IVirtualRolesList {
  populated_roles_list?: ISysRoleDocument[]
}

export class WalnutAdminVirtualRolesListDTO {
  constructor(partial: Partial<WalnutAdminVirtualRolesListDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysRoleDTOSafe, {
    isArray: true,
    swaggerOptions: {
      title: 'virtual roles list',
    },
  })
  populated_roles_list?: ISysRoleDocument[] | null
}

export function addVirtualRolesCount(schema: Schema) {
  return addVirtual(schema, {
    virtualPath: WalnutDBVirtualName.ROLES_COUNT,
    ref: WalnutDBModelName.SYS_ROLE,
    localField: 'roles',
    foreignField: '_id',
    count: true,
  })
}

export interface IVirtualRolesCount {
  populated_roles_count?: number | null
}

export class WalnutAdminVirtualRolesCountDTO {
  constructor(partial: Partial<WalnutAdminVirtualRolesCountDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'virtual roles count',
    },
  })
  populated_roles_count?: number | null
}

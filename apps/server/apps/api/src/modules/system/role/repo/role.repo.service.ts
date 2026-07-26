import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { ClientSession, Types } from 'mongoose'

import { ISysRoleDocument, ISysRoleModel } from '../schema/role.schema'

/**
 * Role Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 */
@Injectable()
export class SysRoleRepoService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_ROLE)
    private readonly roleModel: ISysRoleModel,
  ) {}

  /**
   * @description find role by id
   */
  async findById(id: string, dbSession?: ClientSession) {
    return this.roleModel.findById(id).session(dbSession!).exec()
  }

  /**
   * @description find roles by ids
   */
  async findByIds(ids: string[], dbSession?: ClientSession) {
    return this.roleModel
      .find({ _id: { $in: ids.map(id => new Types.ObjectId(id)) } })
      .session(dbSession!)
      .exec()
  }

  /**
   * @description find roles by ids with populated menus
   */
  async findRolesWithPopulatedMenus(roleIds: string[], dbSession?: ClientSession) {
    const roles = await this.roleModel
      .find({ _id: { $in: roleIds.map(id => new Types.ObjectId(id)) } })
      .session(dbSession!)
      .exec()

    const rolesStatusOK = roles.filter(i => i !== null && i.status)

    const populatedRoles: ISysRoleDocument[] = []
    for (const role of rolesStatusOK) {
      const populated = await role.populate('populated_menusList')
      populatedRoles.push(populated)
    }

    return populatedRoles
  }
}

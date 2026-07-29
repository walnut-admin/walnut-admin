import { WalnutAdminConstRoleRootId } from '@walnut-server/const/role'
import { Injectable } from '@nestjs/common'
import { Role } from '@walnut/contract'
import { WalnutDBCollectionName } from '@walnut-server/db'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import {
  SysRoleDTOCreateRequest,
  SysRoleDTOListRequest,
  SysRoleDTOUpdateRequest,
} from './dto/role.dto'
import { SysRoleBasicRepository } from './role.basic.repository'

/**
 * Role Service
 *
 * This service has 1:1 mapping with controller endpoints.
 * NO direct Model usage - all data access through Repository/Repo Service layer.
 */
@Injectable()
export class SysRoleService {
  constructor(
    private readonly roleBasicRepo: SysRoleBasicRepository,
  ) {}

  /**
   * @description create role (controller: create)
   */
  async create(dto: SysRoleDTOCreateRequest) {
    // cannot create root/developer role
    if (dto.roleName === Role.ROOT || dto.roleName === Role.DEVELOPER) {
      throw new WalnutAdminExceptionBadRequest()
    }
    return this.roleBasicRepo.create(dto)
  }

  /**
   * @description read role by id (controller: read)
   */
  async read(id: string) {
    return (await this.roleBasicRepo.readById(id)).populate<{
      populated_usersCount: number
    }>('populated_usersCount')
  }

  /**
   * @description update role (controller: update)
   */
  async update(id: string, dto: SysRoleDTOUpdateRequest) {
    // cannot update root role
    if (dto.roleName === Role.ROOT || id.toString() === WalnutAdminConstRoleRootId) {
      throw new WalnutAdminExceptionBadRequest()
    }
    return this.roleBasicRepo.update(id, dto)
  }

  /**
   * @description list roles (controller: list)
   */
  async list(params: SysRoleDTOListRequest) {
    return this.roleBasicRepo.list(params, [
      {
        $project: {
          roleName: 1,
          description: 1,
          order: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      {
        $lookup: {
          from: WalnutDBCollectionName.USER,
          localField: '_id',
          foreignField: 'roles',
          as: 'users',
        },
      },
      { $addFields: { populated_usersCount: { $size: '$users' } } },
      { $unset: 'users' },
    ])
  }
}

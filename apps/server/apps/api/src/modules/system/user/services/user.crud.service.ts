import { Injectable } from '@nestjs/common'
import { WalnutAdminConstSafeRoleId, WalnutAdminConstSafeUserId } from '@walnut-server/const/role'
import { WalnutDBCollectionName, WalnutDBVirtualName } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { } from '@walnut/contract'
import { ClientSession, Types } from 'mongoose'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import {
  SysUserDTOCreateRequest,
  SysUserDTOListRequest,
  SysUserDTOUpdateRequest,
} from '../dto/user.dto'
import { SysUserBasicRepository } from '../user.basic.repository'

@Injectable()
export class SysUserCrudService {
  constructor(
    private readonly sysUserBasicRepo: SysUserBasicRepository,
    private readonly cacheAppSettingsSerice: AppTechCacheAppSettingsService,
  ) { }

  // base crud
  async create(dto: SysUserDTOCreateRequest) {
    const functionalRole = await this.cacheAppSettingsSerice.getFunctionalRole()

    // cannot create user with safe role
    if (dto.roles.some(i => WalnutAdminConstSafeRoleId.includes((i as Types.ObjectId).toString()))) {
      throw new WalnutAdminExceptionBadRequest()
    }

    return this.sysUserBasicRepo.create({
      ...dto,
      roles: dto.roles ?? [new Types.ObjectId(functionalRole.defaultRole)],
      currentRole: dto.roles[0] ?? new Types.ObjectId(functionalRole.defaultRole),
    })
  }

  async read(id: string, dbSession?: ClientSession) {
    return (await this.sysUserBasicRepo.readById(id, dbSession)).populate({ path: WalnutDBVirtualName.ROLES_LIST, options: { session: dbSession } })
  }

  async update(id: string, dto: SysUserDTOUpdateRequest) {
    return this.sysUserBasicRepo.update(id, dto)
  }

  async delete(id: string, userId: string, dbSession?: ClientSession) {
    // cannot delete self
    if (id.toString() === userId.toString()) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // cannot delete safe user
    if (WalnutAdminConstSafeUserId.includes(id)) {
      throw new WalnutAdminExceptionBadRequest()
    }

    return this.sysUserBasicRepo.deleteSoftById(id, userId, dbSession)
  }

  async list(params: SysUserDTOListRequest) {
    return this.sysUserBasicRepo.list(params, [
      {
        $lookup: {
          from: WalnutDBCollectionName.ROLE,
          localField: 'roles',
          foreignField: '_id',
          as: `${WalnutDBVirtualName.ROLES_LIST}`,
          pipeline: [
            {
              $project: {
                roleName: 1,
              },
            },
          ],
        },
      },
      { $addFields: { [WalnutDBVirtualName.ROLES_COUNT]: { $size: `$${WalnutDBVirtualName.ROLES_LIST}` } } },
    ])
  }
}

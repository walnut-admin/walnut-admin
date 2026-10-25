import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { WalnutAdminConstSafeRoleId, WalnutAdminConstSafeUserId } from '@walnut-server/const/role'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import {
  SysUserDTOCreateRequest,
  SysUserDTOListRequest,
  SysUserDTOUpdateRequest,
} from '../dto/user.dto'
import { SysUserRepositoryService } from '../repo/user.repo.service'
import { SysUserBasicRepository } from '../user.basic.repository'

@Injectable()
export class SysUserCrudService {
  constructor(
    private readonly sysUserBasicRepo: SysUserBasicRepository,
    private readonly sysUserRepoService: SysUserRepositoryService,
    private readonly cacheAppSettingsSerice: AppTechCacheAppSettingsService,
  ) { }

  // base crud
  async create(dto: SysUserDTOCreateRequest) {
    const functionalRole = await this.cacheAppSettingsSerice.getFunctionalRole()

    // cannot create user with safe role
    // （B7a：PG 侧 id 是 v5 uuid —— safe id 常量同时持有 hex 与 v5 形态，跨引擎窗口两边都拦得住）
    if (dto.roles?.some(i => WalnutAdminConstSafeRoleId.includes(i))) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // defaultRole 经 B5 订正脚本后是 v5 uuid（phase3-plan §5 残留窗口 2），直用不再包装
    return this.sysUserBasicRepo.create({
      ...dto,
      roles: dto.roles ?? [functionalRole.defaultRole],
      currentRole: dto.roles?.[0] ?? functionalRole.defaultRole,
    })
  }

  async read(id: string, em?: EntityManager) {
    const user = await this.sysUserBasicRepo.readById(id, em)
    return this.sysUserRepoService.attachPopulatedRoles(user, em)
  }

  async update(id: string, dto: SysUserDTOUpdateRequest) {
    return this.sysUserBasicRepo.update(id, dto)
  }

  async delete(id: string, userId: string, em?: EntityManager) {
    // cannot delete self
    if (id === userId) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // cannot delete safe user
    if (WalnutAdminConstSafeUserId.includes(id)) {
      throw new WalnutAdminExceptionBadRequest()
    }

    return this.sysUserBasicRepo.deleteSoftById(id, userId, em)
  }

  async list(params: SysUserDTOListRequest) {
    return this.sysUserBasicRepo.list(params)
  }
}

import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { WalnutAdminConstSafeRoleId, WalnutAdminConstSafeUserId } from '@walnut-server/const/role'
import { runAfterCommit } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { AppTechCachePermissionsService } from '@/modules/techniques/cache/service/cache.permissions'
import { DataScopeService } from '../../data-scope/data-scope.service'
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
    private readonly cachePermissionsService: AppTechCachePermissionsService,
    private readonly dataScopeService: DataScopeService,
  ) { }

  // base crud
  async create(dto: SysUserDTOCreateRequest, em?: EntityManager) {
    const functionalRole = await this.cacheAppSettingsSerice.getFunctionalRole()

    // cannot create user with safe role
    // （B7a：PG 侧 id 是 v5 uuid —— safe id 常量同时持有 hex 与 v5 形态，跨引擎窗口两边都拦得住）
    if (dto.roles?.some(i => WalnutAdminConstSafeRoleId.includes(i))) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // P1-18（2026-10-28）：create 与 update 口径对齐 —— 显式 `roles: []` 得 junction 空 +
    // currentRole=null（不再落 defaultRole 造成「current 指向 junction 外」的脱钩形态）；
    // 只有 roles **未给**（undefined）才走 defaultRole 兜底。
    const roles = dto.roles === undefined ? [functionalRole.defaultRole] : dto.roles

    // defaultRole 经 B5 订正脚本后是 v5 uuid（phase3-plan §5 残留窗口 2），直用不再包装
    const created = await this.sysUserBasicRepo.create({
      ...dto,
      roles,
      currentRole: roles[0] ?? null,
    }, em)

    // 数据权限复审（P1 对称面）：新用户加入 CUSTOM 角色 R 时，R 的其他成员的
    // 成员快照需要重算 —— 与 update/delete 同口径按角色失效。
    if (roles.length > 0) {
      await runAfterCommit(async () => {
        await this.dataScopeService.invalidateForUserRoleChanges(created.id, roles)
      })
    }

    return created
  }

  async read(id: string, em?: EntityManager) {
    const user = await this.sysUserBasicRepo.readById(id, em)
    return this.sysUserRepoService.attachPopulatedRoles(user, em)
  }

  /**
   * P1-18（2026-10-28）：roles 整组替换后由 repo 校正 current_role_id（不在新集合 →
   * 新集合首角色 / 空集合 → null）。这里补权限缓存失效：用户的 current role 变了，
   * 旧权限串（permission.guard 只读缓存）必须立即作废 —— 按 `AUTH:PERMISSIONS:<user>:*`
   * 一次清掉该用户全部设备（deviceId 维度由缓存键自带，无需枚举）。
   *
   * 数据权限复审（P1）：`sys_user_role` 变更不只影响该用户 —— CUSTOM 的 userIds 是
   * 「角色成员快照」，B 被移出/加入角色 R 时 R 的其他成员也会看到错误的集合。因此
   * 写前取旧角色集、写后与新角色集合并，逐角色调 `invalidateForRole`（角色成员反查 +
   * 逐用户清缓存），最后再清用户自己。
   */
  async update(id: string, dto: SysUserDTOUpdateRequest, em?: EntityManager) {
    const rolesBefore = dto.roles !== undefined
      ? await this.dataScopeService.resolveRoleIdsForUser(id, em)
      : []

    const updated = await this.sysUserBasicRepo.update(id, dto, em)

    if (dto.roles !== undefined) {
      const affectedRoleIds = [...rolesBefore, ...(dto.roles ?? [])]

      await runAfterCommit(async () => {
        await this.cachePermissionsService.delPermissionsForUser(id)
        await this.dataScopeService.invalidateForUserRoleChanges(id, affectedRoleIds)
      })
    }

    return updated
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

    // 删除前取角色集：junction 随主行 CASCADE 后已查不到
    const rolesBefore = await this.dataScopeService.resolveRoleIdsForUser(id, em)
    const deleted = await this.sysUserBasicRepo.deleteSoftById(id, userId, em)

    // junction 随主行 CASCADE：该用户与同角色其他成员的 CUSTOM 成员快照都要失效
    await runAfterCommit(async () => {
      await this.dataScopeService.invalidateForUserRoleChanges(id, rolesBefore)
    })

    return deleted
  }

  async list(params: SysUserDTOListRequest) {
    return this.sysUserBasicRepo.list(params)
  }
}

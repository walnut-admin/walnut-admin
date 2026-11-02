import type { IWalnutAdminRequestList } from '@walnut-server/list'
import type { EntityManager } from 'typeorm'
import { Inject, Injectable } from '@nestjs/common'
import { AppTechCacheAppSettingsService, AppTechCachePermissionsService } from '@walnut-server/cache'
import { WalnutAdminConstSafeRoleId, WalnutAdminConstSafeUserId } from '@walnut-server/const/role'
import { runAfterCommit } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { IIdentityDataScopeInvalidator, WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR } from '../../identity.ports'
import { SysUserEntity } from '../entity/user.entity'
import { SysUserRepositoryService } from '../repo/user.repo.service'
import { SysUserBasicRepository } from '../user.basic.repository'

@Injectable()
export class SysUserCrudService {
  constructor(
    private readonly sysUserBasicRepo: SysUserBasicRepository,
    private readonly sysUserRepoService: SysUserRepositoryService,
    private readonly cacheAppSettingsSerice: AppTechCacheAppSettingsService,
    private readonly cachePermissionsService: AppTechCachePermissionsService,
    @Inject(WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR)
    private readonly dataScopeInvalidator: IIdentityDataScopeInvalidator,
  ) { }

  // base crud
  async create(dto: Partial<SysUserEntity> & { roles?: string[] }, em?: EntityManager) {
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
    return this.sysUserBasicRepo.create({
      ...dto,
      roles,
      currentRole: roles[0] ?? null,
    }, em)
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
   * 数据权限二期（2026-10-30）：CUSTOM 从「角色成员快照」改为「sys_role_dept 部门清单」，
   * 所以角色成员变化**只影响该用户本人**（不再按角色失效同角色其他成员）；
   * 用户部门（deptId）变更同理只影响本人。
   */
  async update(id: string, dto: Partial<SysUserEntity> & { roles?: string[] }, em?: EntityManager) {
    const updated = await this.sysUserBasicRepo.update(id, dto, em)

    if (dto.roles !== undefined || dto.deptId !== undefined) {
      await runAfterCommit(async () => {
        if (dto.roles !== undefined) {
          await this.cachePermissionsService.delPermissionsForUser(id)
        }
        await this.dataScopeInvalidator.invalidateForUser(id)
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

    const deleted = await this.sysUserBasicRepo.deleteSoftById(id, userId, em)

    // junction 随主行 CASCADE；删除后清掉本人 + 任何残留缓存（角色成员快照语义已废除，
    // 同角色其他成员不再受影响）
    await runAfterCommit(async () => {
      await this.dataScopeInvalidator.invalidateForUser(id)
    })

    return deleted
  }

  async list<T>(params: IWalnutAdminRequestList<T>) {
    return this.sysUserBasicRepo.list(params)
  }
}

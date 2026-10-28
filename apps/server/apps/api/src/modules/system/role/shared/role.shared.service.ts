import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { RoleType } from '@walnut/contract'
import { uniqBy } from 'lodash'

import { SharedScopeResolverService } from '@/modules/shared/scopeResolver/scope-resolver.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { SysRoleRepoService } from '../repo/role.repo.service'

/**
 * Role Shared Service
 *
 * Contains complex business logic involving other modules.
 * Used for operations that involve caching, cross-module coordination, etc.
 */
@Injectable()
export class SysRoleSharedService {
  constructor(
    private readonly roleRepoService: SysRoleRepoService,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly scopeResolverService: SharedScopeResolverService,
  ) {}

  /**
   * @description get roles with populated menus
   */
  async getRolesWithPopulatedMenus(roleIds: string[], em?: EntityManager) {
    return this.roleRepoService.findRolesWithPopulatedMenus(roleIds, em)
  }

  /**
   * @description get core menus for user (involves cache and scope resolver)
   *
   * P1-18 根修（2026-10-28）：AT payload 里的 `roleIds` / `currentRole` 是**登录时快照**，
   * 管理端移除角色、恢复用户（junction 未恢复）后它仍指向旧角色。权限计算必须先查
   * `sys_user_role` 的实际绑定，把 payload 过滤到 membership 内：
   * - COMBINE：取 payload.roleIds ∩ 实际绑定（保序）；
   * - SWITCH：currentRole 仍在绑定集才用它，否则回退绑定集首角色；绑定为空 → 空。
   * 这样旧 AT 重拉 `/auth/permissions` 不会复活被移除的角色，恢复用户的权限为空/受控。
   * root/visitor 的 guard 短路读 payload，不受这里影响。
   */
  async getCoreMenus(user: IWalnutAdminAccessTokenPayload, em?: EntityManager) {
    const functionalRole = await this.cacheAppSettingsService.getFunctionalRole()

    const effectiveRoleMode = this.scopeResolverService.resolve(functionalRole, user)

    // 实时 membership（junction 是唯一真源）
    const boundRoleIds = await this.roleRepoService.findRoleIdsByUserId(user.userId, em)
    const boundRoleIdSet = new Set(boundRoleIds)

    let payload: string[]
    if (effectiveRoleMode === WalnutAdminConstRoleMode.COMBINE) {
      payload = user.roleIds.filter(roleId => boundRoleIdSet.has(roleId))
    }
    else if (user.currentRole !== null && boundRoleIdSet.has(user.currentRole)) {
      payload = [user.currentRole]
    }
    else {
      payload = boundRoleIds.slice(0, 1)
    }

    const roles = await this.getRolesWithPopulatedMenus(payload, em)

    const allMenus = roles.map(i => i.menusList).flat()
    // B5：主键 _id → id（PG uuid；多角色菜单去重的键随迁移换形）
    const uniMenus = uniqBy(allMenus, 'id')

    return {
      roleNames: roles.map(i => i.roleName) as RoleType[],
      menus: uniMenus,
    }
  }
}

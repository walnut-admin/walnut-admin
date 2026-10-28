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
   */
  async getCoreMenus(user: IWalnutAdminAccessTokenPayload, em?: EntityManager) {
    const functionalRole = await this.cacheAppSettingsService.getFunctionalRole()

    const effectiveRoleMode = this.scopeResolverService.resolve(functionalRole, user)

    const payload = effectiveRoleMode === WalnutAdminConstRoleMode.COMBINE ? user.roleIds : [user.currentRole]

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

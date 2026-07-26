import { Injectable } from '@nestjs/common'
import { IWalnutAdminConstRole, WalnutAdminConstRoleMode } from '@walnut-server/const/role/index'
import { uniqBy } from 'lodash'
import { ClientSession } from 'mongoose'

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
  async getRolesWithPopulatedMenus(roleIds: string[], dbSession?: ClientSession) {
    return this.roleRepoService.findRolesWithPopulatedMenus(roleIds, dbSession)
  }

  /**
   * @description get core menus for user (involves cache and scope resolver)
   */
  async getCoreMenus(user: IWalnutAdminAccessTokenPayload, dbSession?: ClientSession) {
    const functionalRole = await this.cacheAppSettingsService.getFunctionalRole()

    const effectiveRoleMode = this.scopeResolverService.resolve(functionalRole, user)

    const payload = effectiveRoleMode === WalnutAdminConstRoleMode.COMBINE ? user.roleIds : [user.currentRole]

    const roles = await this.getRolesWithPopulatedMenus(payload, dbSession)

    const allMenus = roles.map(i => i.populated_menusList).flat()
    const uniMenus = uniqBy(allMenus, '_id')

    return {
      roleNames: roles.map(i => i.roleName) as IWalnutAdminConstRole[],
      menus: uniMenus,
    }
  }
}

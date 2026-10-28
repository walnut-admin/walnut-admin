import type { SysRoleSharedService } from '../../role/shared/role.shared.service'
import type { SysMenuRepositoryService } from '../repo/menu.repo.service'
import type { AppTechCachePermissionsService } from '@/modules/techniques/cache/service/cache.permissions'
import { WalnutAdminConstAppPermissionType } from '@walnut-server/const/app/permission'
import { describe, expect, it } from 'vitest'

import { SysMenuSharedService } from './menu.shared.service'

// P1-8 配套单测：sys_menu 空表边界（修复前两处 `[0].children` 解引用 → TypeError → 50000）。
// 用最小 stub 构造服务，覆盖两条组装出口：
// - getCorePermissions(ALL)：permissionMenuTree[0] 为 undefined 时 indexMenuName 回 ''；
// - getMenuTreeAndTreeWithoutTypeElement：fullTree[0] 为 undefined 时 fullTree 回 []。

function createService(options?: { rootMenu?: unknown, menus?: unknown[] }) {
  const menuRepo = {
    findAllMenus: async () => [],
    findRootMenu: async () => options?.rootMenu ?? null,
  } as unknown as SysMenuRepositoryService

  const roleShared = {
    getCoreMenus: async () => ({ menus: options?.menus ?? [], roleNames: ['user'] }),
  } as unknown as SysRoleSharedService

  const cachePermissions = {} as unknown as AppTechCachePermissionsService

  return new SysMenuSharedService(menuRepo, roleShared, cachePermissions)
}

const user = {
  userId: '00000000-0000-4000-8000-000000000000',
  userName: 'p1-8-empty-menu',
  roleIds: [],
  roleNames: ['user'],
  currentRole: '00000000-0000-4000-8000-000000000001',
  roleMode: 'switchable',
  currentRoleName: 'user',
  mfaSetup: true,
  mfaVerified: true,
} as unknown as IWalnutAdminAccessTokenPayload

describe('menu shared service：空菜单表受控空形态（P1-8）', () => {
  it('getCorePermissions(ALL)：空表 → 全量空树/空串，indexMenuName 回空串（不抛 TypeError）', async () => {
    const service = createService()

    const res = await service.getCorePermissions(user, WalnutAdminConstAppPermissionType.ALL)

    expect(res.permissionStrings).toEqual([])
    expect(res.permissionMenuTree).toEqual([])
    expect(res.permissionRouteTree).toEqual([])
    expect(res.keepAliveNames).toEqual([])
    expect(res.affixedTabs).toEqual([])
    expect(res.indexMenuName).toBe('')
    expect(res.internalIframeList).toEqual([])
  })

  it('getMenuTreeAndTreeWithoutTypeElement：空表 → fullTree 回 []（不抛 TypeError）', async () => {
    const service = createService()

    const res = await service.getMenuTreeAndTreeWithoutTypeElement()

    expect(res.fullTree).toEqual([])
    expect(res.treeWithoutTypeElement).toEqual([])
    expect(res.menuActiveNamesOptions).toEqual([])
  })
})

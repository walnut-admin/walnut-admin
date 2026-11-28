/**
 * 冒烟：缓存清空后系统仍可用（运维最危险的那个按钮）。
 *
 * 调研报告（`.tmp-e2e-research/coverage-gap-matrix.md` Top 5 #5）：`app/monitor/cache` 的
 * 「清空全部」是**不可逆的全局操作**，之前全仓零覆盖。本用例走 admin 监控页同一个端点
 * `DELETE /app/monitor/cache/clear`，验证三件事：
 *
 * 1. **清空真的发生**：`SYS_LANG_LIST_PUBLIC`（`@WalnutAdminDecoratorCache` 写出的
 *    CONTROLLER 类型缓存）从监控列表消失；
 * 2. **受保护类型不被清**：`APP:SETTING` 是 BUILT_IN（见 `cache.service.clear` 的白名单：
 *    BUILT_IN / AUTH / SYSTEM 不删）—— 设置 / 登录态 / 权限缓存必须还在，否则「清缓存」
 *    会把在线用户一起清掉；
 * 3. **系统仍可用**：权限、个人资料、菜单树三条关键读腿仍 `20000`，且被清掉的控制器缓存
 *    在下次读取时**自动重建**（不白屏、不 500）。
 *
 * 为什么走协议而不是 UI：本用例要证的是端点的全局语义，不是确认弹窗的交互；同 project 的
 * 其它 spec 也是协议优先。副作用边界：clear 只删 CONTROLLER / SHARED 类型，不动 AUTH /
 * SYSTEM / BUILT_IN，因此不会污染后续用例的登录态；`repo.clear` 的写路径仍由 protocol
 * 客户端真实调用，不存在裸 SQL 伪造。
 */
import type { AppMonitorCacheListPage } from '../../lib/protocol/api-types.ts'
import { AppRoutes, AuthRoutes, SystemEndpointRoutes } from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { expect, test } from '../fixtures.ts'

/** 服务端 `WalnutAdminConstAppCacheKeys.SYS_LANG_LIST_PUBLIC`（server-only const，未上 contract） */
const PUBLIC_LANG_CACHE_KEY = 'SYSTEM:LANGUAGE:PUBLIC_LIST'
/** 服务端 `WalnutAdminConstAppCacheKeys.APP_SETTING`（BUILT_IN，clear 的受保护类型） */
const APP_SETTING_CACHE_KEY = 'APP:SETTING'

interface PermissionsSnapshot {
  permissionMenuTree: unknown[]
  permissionRouteTree: unknown[]
  permissionStrings: string[]
}

interface ProfileSnapshot {
  id: string
  userName: string
}

interface MenuTreeSnapshot {
  fullTree: unknown[]
}

async function cacheRowsForKey(
  client: Awaited<ReturnType<typeof rootClient>>,
  key: string,
): Promise<AppMonitorCacheListPage['data']> {
  const page = await client.root<AppMonitorCacheListPage>(
    'POST',
    `${AppRoutes.MONITOR_CACHE}/list`,
    {
      filters: [{ field: 'key', op: 'eq', value: key }],
      page: { page: 1, pageSize: 20 },
    },
  )
  return page.data
}

test(
  '缓存清空后系统仍可用：控制器缓存被清并自动重建，设置/权限/菜单仍 20000',
  { tag: '@smoke' },
  async () => {
    const root = await rootClient()

    // 1. 预热 CONTROLLER 类型缓存：public 语言列表由 @WalnutAdminDecoratorCache 写 SYS_LANG_LIST_PUBLIC。
    //    不依赖「admin 启动时恰好请求过」——显式读一次，把前置条件钉死在本用例内。
    const langList = await root.root<unknown[]>('GET', SystemEndpointRoutes.LANG_LIST_PUBLIC)
    expect(Array.isArray(langList), 'lang/list/public 应返回数组').toBe(true)
    expect(langList.length, 'seed 至少应有一种语言').toBeGreaterThan(0)

    const warmed = await cacheRowsForKey(root, PUBLIC_LANG_CACHE_KEY)
    expect(
      warmed.length,
      `${PUBLIC_LANG_CACHE_KEY} 没有被写入控制器缓存（@WalnutAdminDecoratorCache 失效？）`,
    ).toBe(1)
    expect(warmed[0]!.type).toBe('controller')

    // 2. 清空全部（admin 监控页「清空全部」按钮调用的同一端点）
    await expect(
      root.root<boolean>('DELETE', `${AppRoutes.MONITOR_CACHE}/clear`),
      'cache/clear 应返回 true（有键被删）',
    ).resolves.toBe(true)

    // 3. 被清掉的控制器缓存消失；BUILT_IN 的 APP:SETTING 必须保留
    expect(
      await cacheRowsForKey(root, PUBLIC_LANG_CACHE_KEY),
      'clear 后控制器缓存不应还在',
    ).toHaveLength(0)
    expect(
      await cacheRowsForKey(root, APP_SETTING_CACHE_KEY),
      'APP:SETTING 是 BUILT_IN，clear 不应删除（否则清缓存会把全局设置一起抹掉）',
    ).toHaveLength(1)

    // 4. 关键读腿仍可用：root() 对非 20000 直接抛错，这里再断言真实形状
    const permissions = await root.root<PermissionsSnapshot>('GET', AuthRoutes.PERMISSIONS)
    expect(
      Array.isArray(permissions.permissionMenuTree),
      'clear 后 permissions 缺 permissionMenuTree',
    ).toBe(true)
    expect(
      permissions.permissionMenuTree.length,
      'clear 后 permissions 的菜单树为空',
    ).toBeGreaterThan(0)
    expect(
      Array.isArray(permissions.permissionRouteTree),
      'clear 后 permissions 缺 permissionRouteTree',
    ).toBe(true)
    expect(permissions.permissionStrings.length, 'clear 后权限串为空').toBeGreaterThan(0)

    const profile = await root.root<ProfileSnapshot>('GET', SystemEndpointRoutes.USER_ME_PROFILE)
    expect(typeof profile.id, 'clear 后 profile 读不到 id').toBe('string')
    expect(typeof profile.userName).toBe('string')

    const menuTree = await root.root<MenuTreeSnapshot>('GET', SystemEndpointRoutes.MENU_TREE)
    expect(Array.isArray(menuTree.fullTree), 'clear 后 menu/tree 缺 fullTree').toBe(true)
    expect(menuTree.fullTree.length, 'clear 后菜单树为空').toBeGreaterThan(0)

    // 5. 被清掉的控制器缓存按需重建：再读一次 public 语言列表，监控列表里应重新出现该键
    const langListAfter = await root.root<unknown[]>('GET', SystemEndpointRoutes.LANG_LIST_PUBLIC)
    expect(langListAfter.length, 'clear 后再次读取语言列表应仍有数据').toBeGreaterThan(0)
    expect(
      await cacheRowsForKey(root, PUBLIC_LANG_CACHE_KEY),
      '清空后再次读取应重建控制器缓存（下一次请求不应一直穿透到数据源）',
    ).toHaveLength(1)
  },
)

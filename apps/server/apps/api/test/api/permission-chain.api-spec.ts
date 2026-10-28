import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import type { SeedPermissionChainFixture } from './helpers/seed-permissions'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { overrideAppSettings } from './helpers/app-settings'
import { performHttpOpaqueLogin, registerRootUserFixture, WALNUT_DEFAULT_VISITOR_ROLE_UUID } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { cleanupPermissionChainSeed, seedPermissionChainUser } from './helpers/seed-permissions'

/**
 * I 段：真实权限链路（菜单 → 角色 → 用户 → AUTH:PERMISSIONS 缓存 → permission.guard
 * 拒绝/放行）—— 既有 34 份 spec 的登录态用户全部走 root 短路（`roleNames[0]==='root'`），
 * 非 root 用户的「权限缓存写 → 读 → 精确匹配 → 40105」链路在 API 层首次被验证。
 *
 * 权限点选真实端点（app/demo 的 `app:demo:list` / `app:demo:read` / `app:demo:delete`，
 * demo.controller Permissions 常量）：授予串挂 element 菜单 junction 到种子角色，
 * 未授予串不建任何行 —— 断言「缓存里有/没有」与「端点放行/40105」双向对齐。
 *
 * 链路依据（读实现钉形）：`getCorePermissions` 从角色 menusList 的 permission
 * 列推导权限串并写入 `AUTH:PERMISSIONS:<userId>:<deviceId>`（GET /auth/permissions 时）；
 * permission.guard 对非 root 用户**只读缓存**（缺失即 40105，无懒重建），命中后全串精确匹配。
 * effective roleMode 默认（app_setting 空表 → scope GLOBAL）恒 switchable，只看 current_role；
 * SWITCH/COMBINE 对照用例经 `app.functional.role` 设置改 LOCAL scope 后观察两态。
 */

interface PermissionsData {
  permissionStrings: string[]
  permissionMenuTree: unknown[]
  indexMenuName: string
}

interface DemoListData {
  data: Array<{ id: string, demoString?: string }>
  total: number
}

describe('I 段：真实权限链路（种子数据 + 非 root 用户拒绝/放行 + 缓存读序 + SWITCH 对照）', () => {
  let app: NestExpressApplication
  /** root 对照客户端（demo 行的唯一写入口，权限链路之外的角色） */
  let admin: WalnutApiClient
  /** 种子非 root 用户客户端（授予 list/read、未授予 delete） */
  let user: WalnutApiClient
  /** SWITCH/COMBINE 对照用户客户端（主角色 list、第二角色 read） */
  let user2: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let rootFixture: WalnutRootUserFixture | null = null
  let seedFixture: SeedPermissionChainFixture | null = null
  let seed2Fixture: SeedPermissionChainFixture | null = null

  /** demoString 挂 IsUppercase：分组前缀全大写（uuid hex 抬大写） */
  const demoGroup = `PERMCHAIN-${seed8.toUpperCase()}`
  let demoId = ''

  function demoPayload(demoString: string) {
    return {
      demoString,
      demoPhoneNumber: `138${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      demoNumber: 1,
      demoBoolean: true,
      demoDate: '2026-01-01T00:00:00.000Z',
      demoEnum: 1,
      demoMongoId: randomUUID(),
      demoObject: { o1: 'OBJ-1', o2: 2, o3: false },
      demoStringArray: ['1', 'a'],
      demoNumberArray: [-1, 2],
      demoBooleanArray: [true],
      demoDateArray: ['2026-01-01T00:00:00.000Z'],
      demoEnumArray: [1, 2],
      demoMongoIdArray: [randomUUID()],
    }
  }

  function permissionCacheKey(fixture: SeedPermissionChainFixture, client: WalnutApiClient): string {
    return `${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:${fixture.userId}:${client.deviceId}`
  }

  beforeAll(async () => {
    app = await createApiApp()

    // root 对照用户（既有 fixture 手法）
    admin = await WalnutApiClient.create(app)
    rootFixture = await registerRootUserFixture(app, admin.pgDataSource, `permchain-root-${seed8}`)
    const rootTokens = await performHttpOpaqueLogin(admin, app, rootFixture)
    admin.setAuth(rootTokens)
    await admin.seedMfaVerifiedCache(rootFixture.userId)

    // 种子非 root 用户（授予 app:demo:list / app:demo:read，未授予 app:demo:delete）
    seedFixture = await seedPermissionChainUser(app, admin.pgDataSource, {
      userNamePrefix: `permchain-u1-${seed8}`,
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      grantedPermissions: ['app:demo:list', 'app:demo:read'],
      deniedPermissions: ['app:demo:delete'],
    })
    user = await WalnutApiClient.create(app)
    const userTokens = await performHttpOpaqueLogin(user, app, seedFixture)
    user.setAuth(userTokens)
    await user.seedMfaVerifiedCache(seedFixture.userId)

    // SWITCH/COMBINE 对照用户（主角色 app:demo:list、第二角色 app:demo:read）
    seed2Fixture = await seedPermissionChainUser(app, admin.pgDataSource, {
      userNamePrefix: `permchain-u2-${seed8}`,
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      grantedPermissions: ['app:demo:list'],
      secondRolePermissions: ['app:demo:read'],
    })
    user2 = await WalnutApiClient.create(app)
    const user2Tokens = await performHttpOpaqueLogin(user2, app, seed2Fixture)
    user2.setAuth(user2Tokens)
    await user2.seedMfaVerifiedCache(seed2Fixture.userId)

    // demo 行（read/delete 的靶子，root 唯一写入口）
    const createRes = await admin.root('POST', admin.apiPath('/app/demo'), demoPayload(`${demoGroup}-ROW`))
    expectOk(createRes, 'demo create (admin)')
    demoId = bodyOf<{ id: string }>(createRes).data.id
  })

  afterAll(async () => {
    if (admin !== undefined && rootFixture !== null) {
      // demo 靶行硬删 + 软删快照（若拒绝路径失效产生过软删，这里兜底）
      if (demoId !== '') {
        await admin.pgDataSource.query('DELETE FROM app_demo WHERE id = $1', [demoId])
        await admin.pgDataSource.query('DELETE FROM sys_deleted WHERE deleted_id = $1', [demoId])
      }
      await admin.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [rootFixture.userId])
      await admin.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [rootFixture.roleId])
      await cleanupPermissionChainSeed(
        admin,
        [seedFixture, seed2Fixture].filter((i): i is SeedPermissionChainFixture => i !== null),
        [admin.deviceId, user?.deviceId, user2?.deviceId].filter((i): i is string => typeof i === 'string'),
      )
    }
    await app.close()
  })

  it('种子自洽：用户 role_mode/current_role/mfa_setup + junction 三态 + permission 列形态', async () => {
    const fixture = seedFixture!
    const pg = admin.pgDataSource

    const userRows: Array<{ role_mode: string, current_role_id: string, mfa_setup: boolean }>
      = await pg.query('SELECT role_mode, current_role_id, mfa_setup FROM sys_user WHERE id = $1', [fixture.userId])
    expect(userRows[0].role_mode).toBe(WalnutAdminConstRoleMode.COMBINE)
    expect(userRows[0].current_role_id).toBe(fixture.mainRoleId)
    expect(userRows[0].mfa_setup).toBe(true)

    // 用户 junction 只剩种子主角色（visitor 兜底 junction 已删 —— AT payload roleNames 干净）
    const userRoleRows: Array<{ role_id: string }>
      = await pg.query('SELECT role_id FROM sys_user_role WHERE user_id = $1', [fixture.userId])
    expect(userRoleRows.map(r => r.role_id)).toEqual([fixture.mainRoleId])

    // 角色 junction 恰好挂授予集的 element 行（一行一权限点）
    const elementIds = fixture.menuIds.slice(0, fixture.grantedPermissions.length)
    const roleMenuRows: Array<{ menu_id: string }>
      = await pg.query('SELECT menu_id FROM sys_role_menu WHERE role_id = $1', [fixture.mainRoleId])
    expect(roleMenuRows.map(r => r.menu_id).sort()).toEqual([...elementIds].sort())

    // permission 列即权限串（meta 拍平列，`*:*:*` 形态直存）
    const menuRows: Array<{ permission: string }>
      = await pg.query('SELECT permission FROM sys_menu WHERE id = ANY($1::uuid[])', [elementIds])
    expect(menuRows.map(r => r.permission).sort()).toEqual([...fixture.grantedPermissions].sort())
  })

  it('GET /auth/permissions（非 root）：权限串恰为授予集 + 权限缓存键写入 + element 不进菜单树', async () => {
    const fixture = seedFixture!
    const res = await user.root('GET', user.apiPath('/auth/permissions'))
    expectOk(res, 'auth permissions (seeded user)')

    const data = bodyOf<PermissionsData>(res).data
    expect([...data.permissionStrings].sort()).toEqual([...fixture.grantedPermissions].sort())
    expect(data.permissionStrings).not.toContain(fixture.deniedPermissions[0])

    // 种子树是「单 CATALOG 根 + element 子行」：element 不进菜单树、根无子级 → 顶层空、index 空
    expect(data.permissionMenuTree).toEqual([])
    expect(data.indexMenuName).toBe('')

    // 权限缓存键写入（guard 消费的就是这条通道）
    expect(await user.hasWalnutCacheKey(permissionCacheKey(fixture, user))).toBe(true)
  })

  it('放行路径：授予的权限点端点 20000（list 过滤命中 + read 回读一致）', async () => {
    const listRes = await user.root('POST', user.apiPath('/app/demo/list'), {
      query: { demoString: demoGroup },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'demo list (seeded user, granted app:demo:list)')
    const list = bodyOf<DemoListData>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].id).toBe(demoId)

    const readRes = await user.root('GET', user.apiPath(`/app/demo/${demoId}`))
    expectOk(readRes, 'demo read (seeded user, granted app:demo:read)')
    // demoString 出参被 DTO 折成小写（demo.api-spec 同款口径：比较前 toUpperCase）
    expect(bodyOf<{ id: string, demoString?: string }>(readRes).data.demoString?.toUpperCase()).toBe(`${demoGroup}-ROW`)
  })

  it('拒绝路径：未授予的权限点 40105（缓存命中但全串不匹配），行未被软删', async () => {
    const fixture = seedFixture!
    // 前置：缓存确实在场（排除「缓存缺失 40105」的混淆路径 —— 那是下一用例的读序钉子）
    expect(await user.hasWalnutCacheKey(permissionCacheKey(fixture, user))).toBe(true)

    const deleteRes = await user.root('DELETE', user.apiPath(`/app/demo/${demoId}`))
    expect(bodyOf(deleteRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION)

    // 行未被删（admin 视角仍可读；非 root 的 deleteMany 同权限点同样不试 —— 同一 guard 判定）
    const readRes = await admin.root('GET', admin.apiPath(`/app/demo/${demoId}`))
    expectOk(readRes, 'demo read (admin, row survives)')
  })

  it('缓存读序：清 AUTH:PERMISSIONS 键后放行端点转 40105（guard 只读缓存、无懒重建），重拉恢复', async () => {
    const fixture = seedFixture!
    const cacheKey = permissionCacheKey(fixture, user)
    await user.cleanupFixedCacheKeys(cacheKey)
    expect(await user.hasWalnutCacheKey(cacheKey)).toBe(false)

    const deniedRes = await user.root('POST', user.apiPath('/app/demo/list'), {
      query: { demoString: demoGroup },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expect(bodyOf(deniedRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION)

    // 重拉权限 → 缓存写回 → 放行恢复（写路径可重入，链路闭环）
    const rePullRes = await user.root('GET', user.apiPath('/auth/permissions'))
    expectOk(rePullRes, 'auth permissions re-pull')
    expect(await user.hasWalnutCacheKey(cacheKey)).toBe(true)

    const allowedRes = await user.root('POST', user.apiPath('/app/demo/list'), {
      query: { demoString: demoGroup },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(allowedRes, 'demo list after cache restore')
  })

  it('SWITCH/COMBINE 对照：settings LOCAL scope 下 COMBINE 合并双角色、SWITCH 只看 current_role', async () => {
    const fixture = seed2Fixture!
    // 集成库 app_setting 空表 → 默认 GLOBAL/switchable 恒单角色；改写 APP:SETTING 缓存为
    // LOCAL scope 才能让用户自身 roleMode 参与 effective 判定（scopeResolver 读 localKey）
    const restore = await overrideAppSettings(app, {
      [WalnutAdminConstAppSettingKeys.APP_FUNCTIONAL_ROLE]: JSON.stringify({
        scope: 'local',
        globalValue: WalnutAdminConstRoleMode.COMBINE,
        localKey: 'roleMode',
        defaultRole: WALNUT_DEFAULT_VISITOR_ROLE_UUID,
      }),
    })

    try {
      // COMBINE 腿：AT payload roleMode=combinable → roleIds 双角色菜单合并（list + read）
      const combineRes = await user2.root('GET', user2.apiPath('/auth/permissions'))
      expectOk(combineRes, 'auth permissions (combine leg)')
      const combineStrings = bodyOf<PermissionsData>(combineRes).data.permissionStrings
      expect(combineStrings).toEqual(expect.arrayContaining([...fixture.grantedPermissions, ...fixture.secondRolePermissions]))

      // SWITCH 腿：role_mode 落库改 switchable + 重新登录（AT payload 登录时固化，必须重签）。
      // 重登前先走真实 signout 撤本设备 RT —— login/finish 的 duplicate 判据是
      // (userId, deviceId) 存在未撤销 RT 行 → 40109（refresh.shared.service generateRefreshToken）
      await admin.pgDataSource.query(
        'UPDATE sys_user SET role_mode = $2 WHERE id = $1',
        [fixture.userId, WalnutAdminConstRoleMode.SWITCH],
      )
      const signoutRes = await user2.root('POST', user2.apiPath('/auth/signout'))
      expectOk(signoutRes, 'signout before re-login')
      user2.setAuth(null)
      const switchTokens = await performHttpOpaqueLogin(user2, app, fixture)
      user2.setAuth(switchTokens)
      await user2.seedMfaVerifiedCache(fixture.userId)

      const switchRes = await user2.root('GET', user2.apiPath('/auth/permissions'))
      expectOk(switchRes, 'auth permissions (switch leg)')
      const switchStrings = bodyOf<PermissionsData>(switchRes).data.permissionStrings
      expect(switchStrings).toEqual(expect.arrayContaining(fixture.grantedPermissions))
      expect(switchStrings).not.toContain(fixture.secondRolePermissions[0])
    }
    finally {
      await restore()
    }
  })

  it('root 对照：root 用户同端点 20000 且无权限缓存键（roleNames[0] 短路，不经缓存链路）', async () => {
    const listRes = await admin.root('POST', admin.apiPath('/app/demo/list'), {
      query: { demoString: demoGroup },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'demo list (root short-circuit)')
    expect(bodyOf<DemoListData>(listRes).data.total).toBe(1)

    // root 全程未拉过 /auth/permissions —— 权限缓存键不存在仍放行，短路判据实钉
    const rootCacheKey = `${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:${rootFixture!.userId}:${admin.deviceId}`
    expect(await admin.hasWalnutCacheKey(rootCacheKey)).toBe(false)
  })
})

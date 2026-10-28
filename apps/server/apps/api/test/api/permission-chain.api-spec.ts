import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import type { SeedPermissionChainFixture } from './helpers/seed-permissions'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { overrideAppSettings } from './helpers/app-settings'
import { attemptHttpOpaqueLogin, performHttpOpaqueLogin, registerRootUserFixture, WALNUT_DEFAULT_VISITOR_ROLE_UUID } from './helpers/auth-login'
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
 * P2-9（2026-10-28）：零配置默认（app_setting 空表 → scope GLOBAL）的 globalValue 已从
 * switchable 改为 **combinable** —— COMBINE 用户默认即合并全部角色；SWITCH/COMBINE 对照
 * 用例仍经 `app.functional.role` 改 LOCAL scope，验证「LOCAL 下看用户自身 role_mode」不变。
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
  /** F1 专用用户客户端（移除角色 / 删除恢复的旧 AT 重拉断言） */
  let user3: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let rootFixture: WalnutRootUserFixture | null = null
  let seedFixture: SeedPermissionChainFixture | null = null
  let seed2Fixture: SeedPermissionChainFixture | null = null
  let seed3Fixture: SeedPermissionChainFixture | null = null

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

    // F1 专用用户（主角色 list+read）——「移除角色后旧 AT 重拉」「删除恢复后权限受控」两条
    seed3Fixture = await seedPermissionChainUser(app, admin.pgDataSource, {
      userNamePrefix: `permchain-u3-${seed8}`,
      roleMode: WalnutAdminConstRoleMode.COMBINE,
      grantedPermissions: ['app:demo:list', 'app:demo:read'],
    })
    user3 = await WalnutApiClient.create(app)
    const user3Tokens = await performHttpOpaqueLogin(user3, app, seed3Fixture)
    user3.setAuth(user3Tokens)
    await user3.seedMfaVerifiedCache(seed3Fixture.userId)

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
        [seedFixture, seed2Fixture, seed3Fixture].filter((i): i is SeedPermissionChainFixture => i !== null),
        [admin.deviceId, user?.deviceId, user2?.deviceId, user3?.deviceId].filter((i): i is string => typeof i === 'string'),
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

    // P1-15（2026-10-28）：缓存 TTL 与 AT 有效期同量级（修复前 atTtl*1000，30 分钟 AT
    // 会变成 ~20.8 天）。Redis TTL 为整秒，读回最多比写入值小几秒。
    const atTtl = app.get(ConfigService).get<number>('jwt.access.expire')!
    const cacheTtl = await user.getWalnutCacheTtl(permissionCacheKey(fixture, user))
    expect(cacheTtl).toBeGreaterThan(atTtl - 60)
    expect(cacheTtl).toBeLessThanOrEqual(atTtl)
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

  it('默认 GLOBAL/combinable：零配置下 COMBINE 用户合并双角色（P2-9）', async () => {
    const fixture = seed2Fixture!
    // 集成库 app_setting 空表 = 零配置部署同态：scope GLOBAL + 默认 globalValue combinable
    // → effective roleMode 取 combinable，user2 的 roleIds 双角色菜单合并（list + read）
    const res = await user2.root('GET', user2.apiPath('/auth/permissions'))
    expectOk(res, 'auth permissions (default combinable)')
    const strings = bodyOf<PermissionsData>(res).data.permissionStrings
    expect(strings).toEqual(expect.arrayContaining([...fixture.grantedPermissions, ...fixture.secondRolePermissions]))
  })

  it('SWITCH/COMBINE 对照（LOCAL scope）：COMBINE 合并双角色、SWITCH 只看 current_role', async () => {
    const fixture = seed2Fixture!
    // scope 语义不变：显式改 LOCAL 后 scopeResolver 读用户自身 roleMode（localKey）
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

  it('P0-6：key current/RSA_PAIR 需 app:key:read（未授予 → 40105）；AES_KEY_URL 登录即可读且不带私钥', async () => {
    // RSA 视图：管理面权限点，种子用户只授予 app:demo:list/read → 缓存命中但全串不匹配
    const rsaRes = await user.root('GET', user.apiPath('/app/key/current/RSA_PAIR'))
    expect(bodyOf(rsaRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION)

    // AES 视图：admin 前端 URL 掩码的客户端分发密钥，任一登录态用户可读（无额外权限点）；
    // 空表时 data 为空对象 —— 只断言放行与「永不下发私钥」
    const aesRes = await user.root('GET', user.apiPath('/app/key/current/AES_KEY_URL'))
    expectOk(aesRes, 'key current aes (seeded non-root user)')
    expect(bodyOf(aesRes).data).not.toHaveProperty('privateKeyPem')
  })

  it('P2-16：admin 改角色 menus → 该角色用户的 AUTH:PERMISSIONS 立即失效（守卫拒绝直到重拉）', async () => {
    const fixture = seedFixture!
    // 前置：缓存已写（GET /auth/permissions 是唯一写入口）
    const pull = await user.root('GET', user.apiPath('/auth/permissions'))
    expectOk(pull, 'auth permissions before role menu change')
    expect(await user.hasWalnutCacheKey(permissionCacheKey(fixture, user))).toBe(true)

    const roleRows: Array<{ role_name: string, description: string | null, sort_order: number | null, status: boolean }>
      = await admin.pgDataSource.query(
        'SELECT role_name, description, sort_order, status FROM sys_role WHERE id = $1',
        [fixture.mainRoleId],
      )

    // 角色授权整组替换：menus: []（该角色的用户权限串全部消失）；update DTO 的
    // roleName/description/order/status 是必填（非 partial），按现值回填
    const updateRes = await admin.root('PUT', admin.apiPath(`/system/role/${fixture.mainRoleId}`), {
      roleName: roleRows[0].role_name,
      description: roleRows[0].description ?? 'seed role',
      order: roleRows[0].sort_order ?? 1,
      status: roleRows[0].status,
      menus: [],
    })
    expectOk(updateRes, 'role menus replaced')

    // P2-16 翻转：此前缓存不清 —— 守卫继续沿旧权限串放行。现在 after-commit 反查
    // sys_user_role 并清该用户全部设备键，下一次受保护请求立即 40105。
    expect(await user.hasWalnutCacheKey(permissionCacheKey(fixture, user))).toBe(false)

    const deniedRes = await user.root('POST', user.apiPath('/app/demo/list'), {
      query: { demoString: demoGroup },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expect(bodyOf(deniedRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION)

    // 重拉即反映新授权（空菜单 → 空权限串）
    const rePull = await user.root('GET', user.apiPath('/auth/permissions'))
    expectOk(rePull, 'auth permissions after role menu change')
    expect(bodyOf<PermissionsData>(rePull).data.permissionStrings).toEqual([])
  })

  it('P1-18：admin 移除用户 current 角色 → current_role 校正 + 权限缓存失效；重登后按新角色计算', async () => {
    const fixture = seed2Fixture!

    // 前置：缓存已写（当前角色集 = main + second 合并）
    const pull = await user2.root('GET', user2.apiPath('/auth/permissions'))
    expectOk(pull, 'auth permissions before user roles change')
    expect(await user2.hasWalnutCacheKey(permissionCacheKey(fixture, user2))).toBe(true)

    // admin 整组替换 roles = [secondRole]（current 角色 main 被移出）
    const updateRes = await admin.root('PUT', admin.apiPath(`/system/user/${fixture.userId}`), {
      userName: fixture.userName,
      status: true,
      roles: [fixture.secondRoleId],
    })
    expectOk(updateRes, 'user roles replaced by admin')

    // P1-18：current_role_id 同步校正为新集合首角色
    const updated = bodyOf<{ currentRole: string | null }>(updateRes).data
    expect(updated.currentRole).toBe(fixture.secondRoleId)
    const userRows: Array<{ current_role_id: string | null }> = await admin.pgDataSource.query(
      'SELECT current_role_id FROM sys_user WHERE id = $1',
      [fixture.userId],
    )
    expect(userRows[0].current_role_id).toBe(fixture.secondRoleId)

    // 权限缓存立即失效（不再沿旧角色集放行 list）
    expect(await user2.hasWalnutCacheKey(permissionCacheKey(fixture, user2))).toBe(false)
    const deniedRes = await user2.root('POST', user2.apiPath('/app/demo/list'), {
      query: { demoString: demoGroup },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expect(bodyOf(deniedRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION)

    // AT payload 的角色集在登录时固化 —— 重登后按新 junction 组装，权限串只剩 second
    await user2.root('POST', user2.apiPath('/auth/signout'))
    user2.setAuth(null)
    const relogin = await performHttpOpaqueLogin(user2, app, fixture)
    user2.setAuth(relogin)
    await user2.seedMfaVerifiedCache(fixture.userId)

    const rePull = await user2.root('GET', user2.apiPath('/auth/permissions'))
    expectOk(rePull, 'auth permissions after re-login')
    expect([...bodyOf<PermissionsData>(rePull).data.permissionStrings].sort())
      .toEqual([...fixture.secondRolePermissions].sort())

    // second 角色授予的 read 放行、list（已随 main 移出）拒绝
    const readRes = await user2.root('GET', user2.apiPath(`/app/demo/${demoId}`))
    expectOk(readRes, 'demo read after role replacement')
    const listAfter = await user2.root('POST', user2.apiPath('/app/demo/list'), {
      query: { demoString: demoGroup },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expect(bodyOf(listAfter).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION)
  })

  it('F1：admin 移除角色后旧 AT 重拉权限 —— 按 junction 实际绑定计算，不再含被移除角色', async () => {
    const fixture = seed3Fixture!

    // 前置：旧 AT 拉过一次，缓存里有 main 角色的 list/read（且 AT payload 自报的
    // roleIds/currentRole 也是 main —— 登录时快照）
    const pull = await user3.root('GET', user3.apiPath('/auth/permissions'))
    expectOk(pull, 'auth permissions before role removal (user3)')
    expect([...bodyOf<PermissionsData>(pull).data.permissionStrings].sort())
      .toEqual([...fixture.grantedPermissions].sort())

    // admin 移除全部角色（junction 清空），不重新登录 —— 旧 AT 仍是登录时快照
    const updateRes = await admin.root('PUT', admin.apiPath(`/system/user/${fixture.userId}`), {
      userName: fixture.userName,
      status: true,
      roles: [],
    })
    expectOk(updateRes, 'user roles cleared (user3)')

    // F1 根修：getCoreMenus 先查 sys_user_role 实时 membership，payload 被过滤为空 ——
    // 旧 AT 重拉不得复活 main 角色的权限（修复前会继续返回 list/read）
    const rePull = await user3.root('GET', user3.apiPath('/auth/permissions'))
    expectOk(rePull, 'auth permissions after role removal (user3, old AT)')
    expect(bodyOf<PermissionsData>(rePull).data.permissionStrings).toEqual([])
  })

  it('F1：恢复用户（junction 未恢复）—— 旧 AT 权限为空、重新登录 40103 受控拒绝', async () => {
    const fixture = seed3Fixture!

    // 先恢复角色绑定，让「删除 → 恢复」有可丢失的授权
    const restoreRoles = await admin.root('PUT', admin.apiPath(`/system/user/${fixture.userId}`), {
      userName: fixture.userName,
      status: true,
      roles: [fixture.mainRoleId],
    })
    expectOk(restoreRoles, 'user roles restored (user3)')
    const prePull = await user3.root('GET', user3.apiPath('/auth/permissions'))
    expectOk(prePull, 'auth permissions before delete (user3)')
    expect(bodyOf<PermissionsData>(prePull).data.permissionStrings).toContain('app:demo:list')

    // 删除用户（软删快照：主行 + identity；junction 由 FK CASCADE 清空且不进快照）
    const deleteRes = await admin.root('DELETE', admin.apiPath(`/system/user/${fixture.userId}`))
    expectOk(deleteRes, 'user soft delete (user3)')

    const snapshotRows: Array<{ id: string }> = await admin.pgDataSource.query(
      'SELECT id FROM sys_deleted WHERE deleted_id = $1 AND model_name = \'SysUser\'',
      [fixture.userId],
    )
    expect(snapshotRows).toHaveLength(1)

    // 恢复用户：P2-18 联动恢复 identity，但 junction 不恢复（P2-18 维持登记的部分）
    const recoverRes = await admin.root('POST', admin.apiPath('/system/deleted/recover'), {
      id: snapshotRows[0].id,
      deletedId: fixture.userId,
    })
    expectOk(recoverRes, 'user recover (user3)')

    const junctionRows: Array<{ c: number }> = await admin.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_role WHERE user_id = $1',
      [fixture.userId],
    )
    expect(junctionRows[0].c).toBe(0)

    // F1：旧 AT 重拉 —— 权限计算以空 membership 为准，不得沿用旧角色
    const rePull = await user3.root('GET', user3.apiPath('/auth/permissions'))
    expectOk(rePull, 'auth permissions after recover (user3, old AT)')
    expect(bodyOf<PermissionsData>(rePull).data.permissionStrings).toEqual([])

    // 重新登录：roles_list 为空 → checkUserAndRoleStatus 拒绝；opaque 的 finish 链
    // （validateOpaqueUser 的 try/catch）把状态校验失败统一收敛为 40103（受控，不是 20000）。
    // 登录请求必须回单因子签名（登录态 anon() 无 Authorization 头会 40112）
    user3.setAuth(null)

    // 前置自检：P2-18 的 identity 联动恢复在场（否则 40103 会掩盖「roles 为空」的判据）
    const identityRows: Array<{ c: number }> = await admin.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_identity WHERE user_id = $1 AND type = \'password\' AND purpose = \'login\'',
      [fixture.userId],
    )
    expect(identityRows[0].c).toBe(1)

    const loginAttempt = await attemptHttpOpaqueLogin(user3, app, fixture)
    expect(loginAttempt.code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_CREDENTIALS)
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

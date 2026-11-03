import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { makeMonitorState, makeMonitorVisitorId, makeSeed8 } from './helpers/factories'

/**
 * B 段：`app/monitor/user` —— CRUD list/read + `POST state`（Sign/Jwt/Cap/Device 全
 * Free 的匿名上报，deviceId 取签名 cookie；**F-47 起** body 里的 userId 不再被采信，
 * 只有携带验签通过的 AT 才会把 user_id 落库）+ `DELETE force-quit/:id`（@WalnutTx，
 * admin-kick 撤销该用户该设备的 refresh token；socket 未装配时 sendToRoom 走 `socket?.`
 * 空安全，在线踢下线在测试环境为 no-op）。
 *
 * 在线状态自建自清：state 端点 upsert `app_monitor_user`（visitor_id 唯一）；force-quit
 * 前手插一行 auth_refresh_token（user+device 维度），踢完断言 revoked 落库。
 *
 * P2-12（2026-10-28）：force-quit（admin-kick）在撤 RT 之外，事务提交后按设备清
 * `AUTH:SESSIONS` / `AUTH:PERMISSIONS` / `AUTH:MFA:VERIFIED` —— 配合 P0-4 的 JWT
 * 会话校验，被踢设备的旧 AT 立即 40101（本文件用第二设备真实验证）。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface MonitorRow {
  id: string
  // P0-2：响应面**不再有** visitorId（原始指纹只在入参：list 过滤 / state 心跳）。
  // 这里刻意不声明该字段 —— 若哪天响应又把指纹带回来，本文件的断言会先红。
  userId?: string | null
  deviceId?: string | null
  auth?: boolean
  left?: boolean
  currentRouter?: string | null
  device?: { deviceId?: string, deviceName?: string } | null
  user?: { id?: string, userName?: string | null } | null
}

describe('B 段：app/monitor/user state/list/read/force-quit（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = makeSeed8()
  /** 本轮两个访客（uq_monitor_visitor 唯一） */
  const visitorA = makeMonitorVisitorId(seed8, 'a')
  const visitorB = makeMonitorVisitorId(seed8, 'b')
  let fixture: WalnutRootUserFixture | null = null
  let monitorIdA = ''
  /** force-quit 用例的“第二设备”（同用户）—— 被 admin-kick 后断言 AT 立即失效 */
  let victim: WalnutApiClient | null = null

  async function deleteMonitorRows() {
    await api.pgDataSource.query('DELETE FROM app_monitor_user WHERE visitor_id LIKE $1', [`vis-${seed8}%`])
    if (fixture !== null) {
      await api.pgDataSource.query('DELETE FROM auth_refresh_token WHERE user_id = $1', [fixture.userId])

      if (victim !== null) {
        const cacheService = app.get(AppTechCacheService)
        await api.pgDataSource.query('DELETE FROM sys_user_device WHERE user_id = $1 AND device_id = $2', [fixture.userId, victim.deviceId])
        await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [victim.deviceId])
        await cacheService.del(`${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:${fixture.userId}:${victim.deviceId}`)
        await cacheService.del(`${WalnutAdminConstAppCacheKeys.AUTH_MFA_VERIFIED}:${fixture.userId}:${victim.deviceId}`)
        victim = null
      }
    }
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `mu-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterEach(async () => {
    await deleteMonitorRows()
    monitorIdA = ''
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await deleteMonitorRows()
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  /**
   * F-47：`userId` 只认「验签通过的 AT」（README 式的口径见 user.controller.ts 的
   * resolveVerifiedUserId）。所以「已登录上报」用 root（带 AT + 双因子签名；state 端点
   * Sign Free，签名头被忽略但无害）。无 AT 的匿名上报另有用例 —— 体里带 userId 也
   * 必须落 NULL。
   */
  async function createOnlineMonitorA(client: WalnutApiClient = api): Promise<string> {
    const res = await client.root('POST', client.apiPath('/app/monitor/user/state'), makeMonitorState({
      visitorId: visitorA,
      auth: true,
      userId: fixture!.userId,
      focus: true,
      currentRouter: '/dashboard',
    }))
    expectOk(res, 'monitor user state A')
    const rows: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM app_monitor_user WHERE visitor_id = $1',
      [visitorA],
    )
    return rows[0].id
  }

  it('state（带 AT）→ 20000，在线状态 upsert 落库（user/device 绑定）', async () => {
    monitorIdA = await createOnlineMonitorA()
    expect(monitorIdA).toMatch(UUID_RE)

    const rows: Array<Record<string, unknown>> = await api.pgDataSource.query(
      'SELECT user_id, device_id, auth, is_left, current_router FROM app_monitor_user WHERE visitor_id = $1',
      [visitorA],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe(fixture!.userId)
    expect(rows[0].device_id).toBe(api.deviceId)
    expect(rows[0].auth).toBe(true)
    expect(rows[0].is_left).toBe(false)
    expect(rows[0].current_router).toBe('/dashboard')
  })

  it('F-47：匿名上报即使 body 里带 userId 也不落库（user_id 恒 NULL，心跳照常生效）', async () => {
    const res = await api.anon('POST', api.apiPath('/app/monitor/user/state'), makeMonitorState({
      visitorId: visitorB,
      auth: true,
      // 伪造的身份声明：没有 AT ⇒ controller 覆盖成 null ⇒ service 的 nil 过滤丢弃
      userId: fixture!.userId,
      focus: true,
    }))
    expectOk(res, 'anonymous monitor state with spoofed userId')

    const rows: Array<{ user_id: string | null, auth: boolean, focus: boolean }> = await api.pgDataSource.query(
      'SELECT user_id, auth, focus FROM app_monitor_user WHERE visitor_id = $1',
      [visitorB],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBeNull()
    // 匿名心跳的其余字段不受影响（无 AT 也能更新 state，只是不关联用户）
    expect(rows[0].auth).toBe(true)
    expect(rows[0].focus).toBe(true)
  })

  it('read → 20000，device / user 按 ID 装回', async () => {
    monitorIdA = await createOnlineMonitorA()

    const res = await api.root('GET', api.apiPath(`/app/monitor/user/${monitorIdA}`))
    expectOk(res, 'monitor user read')

    const row = bodyOf<MonitorRow>(res).data
    // P0-2：原始指纹绝不下发（deviceId = HMAC(指纹)，回显指纹等于下发设备身份）
    expect(row).not.toHaveProperty('visitorId')
    expect(row.device?.deviceId).toBe(api.deviceId)
    expect(row.user?.id).toBe(fixture!.userId)
    expect(row.user?.userName).toBe(fixture!.userName)
  })

  it('list → visitorId 过滤命中；匿名访客行（auth=false）userId 置空', async () => {
    monitorIdA = await createOnlineMonitorA()

    // 匿名访客 B：auth=false 走 userId 置 null 语义
    const stateB = await api.anon('POST', api.apiPath('/app/monitor/user/state'), makeMonitorState({
      visitorId: visitorB,
      auth: false,
    }))
    expectOk(stateB, 'monitor user state B')

    const listRes = await api.root('POST', api.apiPath('/app/monitor/user/list'), {
      filters: [{ field: 'visitorId', op: 'like', value: visitorB }],
      sort: [{ field: 'firstVisitAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'monitor user list')

    const list = bodyOf<{ data: MonitorRow[], total: number }>(listRes).data
    expect(list.total).toBe(1)
    // 入参可以按指纹过滤（查询命中 1 行），但出参不回显指纹本身（P0-2）
    expect(list.data[0]).not.toHaveProperty('visitorId')
    expect(list.data[0].userId).toBeNull()

    const bRows: Array<{ user_id: string | null }> = await api.pgDataSource.query(
      'SELECT user_id FROM app_monitor_user WHERE visitor_id = $1',
      [visitorB],
    )
    expect(bRows[0].user_id).toBeNull()
  })

  it('P2-31：已登录访客上报 auth=false → user_id 清空（旧实现残留上次登录用户）', async () => {
    monitorIdA = await createOnlineMonitorA()

    // 前置：该行确实绑定了用户
    const bindRows: Array<{ user_id: string | null }> = await api.pgDataSource.query(
      'SELECT user_id FROM app_monitor_user WHERE visitor_id = $1',
      [visitorA],
    )
    expect(bindRows[0].user_id).toBe(fixture!.userId)

    // 登出上报：auth=false 且不带 userId —— P2-31 前 null 被 nil 过滤丢弃，user_id 残留
    const stateOff = await api.anon('POST', api.apiPath('/app/monitor/user/state'), makeMonitorState({
      visitorId: visitorA,
      auth: false,
    }))
    expectOk(stateOff, 'monitor user state auth=false')

    const rows: Array<{ user_id: string | null, auth: boolean }> = await api.pgDataSource.query(
      'SELECT user_id, auth FROM app_monitor_user WHERE visitor_id = $1',
      [visitorA],
    )
    expect(rows[0].auth).toBe(false)
    expect(rows[0].user_id).toBeNull()

    // read 不再按 user_id 装回上次登录用户
    const readRes = await api.root('GET', api.apiPath(`/app/monitor/user/${monitorIdA}`))
    expectOk(readRes, 'monitor user read after signout')
    expect(bodyOf<MonitorRow>(readRes).data.user).toBeNull()
  })

  it('force-quit → 20000，admin-kick 撤销 RT；P2-12：旧 AT 立即 40101 + 设备缓存全清', async () => {
    // 第二设备真实登录（同一 fixture 用户）—— 被 admin-kick 的靶子
    victim = await WalnutApiClient.create(app)
    const victimTokens = await performHttpOpaqueLogin(victim, app, fixture!)
    victim.setAuth(victimTokens)

    // monitor 行绑定受害者设备（state 端点的 deviceId 取调用方 cookie）
    monitorIdA = await createOnlineMonitorA(victim)

    // 造一行未撤销的 refresh token（user+device 维度），踢完必须 revoked=true
    await api.pgDataSource.query(
      'DELETE FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, victim.deviceId],
    )
    await api.pgDataSource.query(
      `INSERT INTO auth_refresh_token (jti, user_id, device_id, encrypted_token, expired_at)
       VALUES ($1, $2, $3, 'apispec-rt', NOW() + INTERVAL '1 day')`,
      [randomUUID(), fixture!.userId, victim.deviceId],
    )

    // 预置权限 / MFA verified 缓存（清扫前必须存在）
    const cacheService = app.get(AppTechCacheService)
    const permissionKey = `${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:${fixture!.userId}:${victim.deviceId}`
    const mfaKey = `${WalnutAdminConstAppCacheKeys.AUTH_MFA_VERIFIED}:${fixture!.userId}:${victim.deviceId}`
    await cacheService.set(permissionKey, ['app:monitor:user:list'], { t: WalnutAdminConstAppCacheType.AUTH, ttl: 600 })
    await victim.seedMfaVerifiedCache(fixture!.userId)
    expect(await api.hasWalnutCacheKey(permissionKey)).toBe(true)
    expect(await api.hasWalnutCacheKey(mfaKey)).toBe(true)

    const res = await api.root('DELETE', api.apiPath(`/app/monitor/user/force-quit/${monitorIdA}`))
    expectOk(res, 'monitor user force-quit')

    const rtRows: Array<{ revoked: boolean, revoke_reason: string | null }> = await api.pgDataSource.query(
      'SELECT revoked, revoke_reason FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, victim.deviceId],
    )
    expect(rtRows).toHaveLength(1)
    expect(rtRows[0].revoked).toBe(true)

    // P2-12 翻转：旧 AT 立即失效（JWT validate 查会话键，P0-4）
    const victimAfterKick = await victim.root('GET', victim.apiPath('/system/user/device/list'))
    expect(bodyOf(victimAfterKick).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

    expect(await api.hasWalnutCacheKey(permissionKey)).toBe(false)
    expect(await api.hasWalnutCacheKey(mfaKey)).toBe(false)
  })

  it('边界：read 不存在 uuid → 40401', async () => {
    const readRes = await api.root('GET', api.apiPath(`/app/monitor/user/${randomUUID()}`))
    expect(bodyOf(readRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  })

  it('边界：force-quit 无行 → 20000 + data=false；非法 uuid → 40002', async () => {
    const quitRes = await api.root('DELETE', api.apiPath(`/app/monitor/user/force-quit/${randomUUID()}`))
    expectOk(quitRes, 'force-quit missing monitor')
    expect(bodyOf<boolean>(quitRes).data).toBe(false)

    const badUuid = await api.root('DELETE', api.apiPath('/app/monitor/user/force-quit/not-a-uuid'))
    expect(bodyOf(badUuid).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_INVALID_ID)
  })

  it('边界：匿名 list → 40101（JWT guard 拦在 Sign 之前）', async () => {
    const anonList = await api.anon('POST', api.apiPath('/app/monitor/user/list'), {
      filters: [],
      sort: [],
      page: { page: 1, pageSize: 10 },
    })
    expect(bodyOf(anonList).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })

  it('边界：state 非法 body → 40099（P1-4 已修：异常壳对 skip 路径照常落盘，不再静默悬挂）', async () => {
    // 修复前：路径尾缀 /state 命中 BLPath shouldSkip 后缀表，全局异常过滤器提前
    // return 不落响应，请求悬挂到客户端超时（旧注释为此把本断言整条避开）。
    // 修复后（2026-10-27）：过滤器对 skip 名单只跳过「错误记录」，响应恒落盘。
    const res = await api.anon('POST', api.apiPath('/app/monitor/user/state'), { visitorId: 123 })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

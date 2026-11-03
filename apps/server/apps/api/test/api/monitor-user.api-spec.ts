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
import { makeMonitorState, makeSeed8 } from './helpers/factories'

/**
 * B 段：`app/monitor/user` —— CRUD list/read + `POST state`（Sign/Jwt/Cap/Device 全
 * Free 的匿名上报，deviceId 取签名 cookie；**F-47 起** body 里的 userId 不再被采信，
 * 只有携带验签通过的 AT 才会把 user_id 落库）+ `DELETE force-quit/:id`（@WalnutTx，
 * admin-kick 撤销该用户该设备的 refresh token；socket 未装配时 sendToRoom 走 `socket?.`
 * 空安全，在线踢下线在测试环境为 no-op）。
 *
 * 在线状态自建自清：state 端点 upsert `app_monitor_user`；force-quit 前手插一行
 * auth_refresh_token（user+device 维度），踢完断言 revoked 落库。
 *
 * 批次 8 / B6（行键归属，安全修复）+ 批次 11 / B5 收尾（校验口径改写）—— 本文件的三条钉：
 * 1. **行键 = 服务端从 Cookie 解析的 deviceId**：body 的 visitorId 只作校验。真实客户端
 *    必须把**自己的指纹**（= axios FINGERPRINT 头那个值，测试里是 `client.fingerprint`）
 *    填进 body —— 但那不再是「可计算等式」（B5 之后 deviceId 是服务端随机签发的，指纹与
 *    身份之间没有可计算关系），而是「与本设备已存行比」。
 * 2. **同一设备不能中途换指纹**：本设备首写登记了 A，第二次上报 B ⇒ 40099，且已存行
 *    一个字段都不动（判据见 AppMonitorUserService.updateState 的注释）。
 * 3. **body 的 deviceId 不再可写**：DTO 白名单摘除 + forbidNonWhitelisted ⇒ 40099。
 *
 * 负对照：把 service 的 filter 改回 `{ visitorId }`，第 2 条会红（攻击者会把受害者的行
 * 写成自己的设备）；把 DTO 的 `deviceId` 加回 pick 列表，第 3 条会红。
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
  /** 第二台设备（匿名访客）：行键是它自己的 deviceId，指纹是它自己的 fingerprint */
  let guest: WalnutApiClient

  const seed8 = makeSeed8()
  /** 与 api/guest 都无关的第三个指纹：验证「同设备换指纹」被拒的那条腿 */
  const ATTACKER_FINGERPRINT = `vis-${seed8}-attacker`
  let fixture: WalnutRootUserFixture | null = null
  let monitorIdA = ''
  /** force-quit 用例的「第二设备」（同用户）—— 被 admin-kick 后断言 AT 立即失效 */
  let victim: WalnutApiClient | null = null

  function knownDevices(): string[] {
    return [api?.deviceId, guest?.deviceId, victim?.deviceId].filter((id): id is string => typeof id === 'string' && id !== '')
  }

  async function deleteMonitorRows() {
    // 行键是 device_id（B6），按设备清；指纹列一并做兜底（历史行为留下的行）
    await api.pgDataSource.query('DELETE FROM app_monitor_user WHERE device_id = ANY($1)', [knownDevices()])
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
    guest = await WalnutApiClient.create(app)

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
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1)', [knownDevices()])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  /**
   * F-47：`userId` 只认「验签通过的 AT」（README 式的口径见 user.controller.ts 的
   * resolveVerifiedUserId）。所以「已登录上报」用 root（带 AT + 双因子签名；state 端点
   * Sign Free，签名头被忽略但无害）。无 AT 的匿名上报另有用例 —— 体里带 userId 也
   * 必须落 NULL。
   *
   * B6 / B5 收尾：`visitorId` 必须是**该客户端自己的指纹**（`client.fingerprint`，即 axios
   * FINGERPRINT 头携带的同一个值）—— 服务端拿它与「本设备已存行的 visitor_id」比，
   * 首写即登记，之后不一致就 40099。
   */
  async function createOnlineMonitorA(client: WalnutApiClient = api): Promise<string> {
    const res = await client.root('POST', client.apiPath('/app/monitor/user/state'), makeMonitorState({
      visitorId: client.fingerprint,
      auth: true,
      userId: fixture!.userId,
      focus: true,
      currentRouter: '/dashboard',
    }))
    expectOk(res, 'monitor user state A')
    const rows: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM app_monitor_user WHERE device_id = $1',
      [client.deviceId],
    )
    return rows[0].id
  }
  it('state（带 AT）→ 20000，在线状态 upsert 落库（行键 = cookie deviceId，指纹仅作校验）', async () => {
    monitorIdA = await createOnlineMonitorA()
    expect(monitorIdA).toMatch(UUID_RE)

    const rows: Array<Record<string, unknown>> = await api.pgDataSource.query(
      'SELECT user_id, device_id, visitor_id, auth, is_left, current_router FROM app_monitor_user WHERE device_id = $1',
      [api.deviceId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe(fixture!.userId)
    // 行键 = 服务端解析的 deviceId；指纹列只是首行登记（B6）
    expect(rows[0].device_id).toBe(api.deviceId)
    expect(rows[0].visitor_id).toBe(api.fingerprint)
    expect(rows[0].auth).toBe(true)
    expect(rows[0].is_left).toBe(false)
    expect(rows[0].current_router).toBe('/dashboard')
  })

  it('B5 收尾负对照：同一设备第二次上报**不同指纹** ⇒ 40099，已存行一个字段都不动', async () => {
    monitorIdA = await createOnlineMonitorA()

    // 这台设备首写已经登记了 api.fingerprint；现在换成别人的指纹再报一次。
    // 判据是「与本设备已存行比」——B5 把 deviceId 改成服务端随机签发后，
    // `HMAC(指纹) === deviceId` 这类可计算等式对所有真实客户端都恒假（那正是批次 11
    // 修掉的每次心跳 40099），所以「已存行」是唯一还站得住的判据。
    const hijack = await api.anon('POST', api.apiPath('/app/monitor/user/state'), makeMonitorState({
      visitorId: ATTACKER_FINGERPRINT,
      auth: true,
      focus: true,
      currentRouter: '/pwned',
    }))
    expect(bodyOf(hijack).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const rows: Array<Record<string, unknown>> = await api.pgDataSource.query(
      'SELECT device_id, visitor_id, current_router FROM app_monitor_user WHERE device_id = $1',
      [api.deviceId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].device_id).toBe(api.deviceId)
    expect(rows[0].visitor_id).toBe(api.fingerprint)
    expect(rows[0].current_router).toBe('/dashboard')
  })

  it('B6：body 里的 deviceId 不再可写（wire 白名单摘除 ⇒ 40099）', async () => {
    // 改造前它是 pick 列表成员：写集由 `{ deviceId, ...updatePayload }` 展开顺序决定胜负
    const res = await api.anon('POST', api.apiPath('/app/monitor/user/state'), {
      ...makeMonitorState({ visitorId: api.fingerprint, auth: true }),
      deviceId: 'a'.repeat(64),
    })

    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const rows: Array<{ device_id: string }> = await api.pgDataSource.query(
      'SELECT device_id FROM app_monitor_user WHERE device_id = $1',
      [api.deviceId],
    )
    expect(rows).toHaveLength(0)
  })

  it('F-47：匿名上报即使 body 里带 userId 也不落库（user_id 恒 NULL，心跳照常生效）', async () => {
    const res = await guest.anon('POST', guest.apiPath('/app/monitor/user/state'), makeMonitorState({
      visitorId: guest.fingerprint,
      auth: true,
      // 伪造的身份声明：没有 AT ⇒ controller 覆盖成 null ⇒ service 的 nil 过滤丢弃
      userId: fixture!.userId,
      focus: true,
    }))
    expectOk(res, 'anonymous monitor state with spoofed userId')

    const rows: Array<{ user_id: string | null, auth: boolean, focus: boolean }> = await api.pgDataSource.query(
      'SELECT user_id, auth, focus FROM app_monitor_user WHERE device_id = $1',
      [guest.deviceId],
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
    // P0-2：原始指纹绝不下发。**现状**的判据不是「deviceId = HMAC(指纹)」（B5 起 device_id 由
    // 服务端随机签发、与指纹无关，判据见 libs/const/src/app/device.ts）—— 指纹是**另一条独立的
    // 设备侧标识**，留着它响应面没有任何用途：要定位设备用 device.deviceId / device.deviceName。
    // 它只活在**请求面**（心跳的校验字段 + list 的查询过滤）。
    expect(row).not.toHaveProperty('visitorId')
    expect(row.device?.deviceId).toBe(api.deviceId)
    expect(row.user?.id).toBe(fixture!.userId)
    expect(row.user?.userName).toBe(fixture!.userName)
  })

  it('list → visitorId 过滤命中；匿名访客行（auth=false）userId 置空', async () => {
    monitorIdA = await createOnlineMonitorA()

    // 匿名访客（第二台设备）：auth=false 走 userId 置 null 语义
    const stateB = await guest.anon('POST', guest.apiPath('/app/monitor/user/state'), makeMonitorState({
      visitorId: guest.fingerprint,
      auth: false,
    }))
    expectOk(stateB, 'monitor user state B')

    const listRes = await api.root('POST', api.apiPath('/app/monitor/user/list'), {
      filters: [{ field: 'visitorId', op: 'like', value: guest.fingerprint }],
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
      'SELECT user_id FROM app_monitor_user WHERE device_id = $1',
      [guest.deviceId],
    )
    expect(bRows[0].user_id).toBeNull()
  })
  it('P2-31：已登录访客上报 auth=false → user_id 清空（旧实现残留上次登录用户）', async () => {
    monitorIdA = await createOnlineMonitorA()

    // 前置：该行确实绑定了用户
    const bindRows: Array<{ user_id: string | null }> = await api.pgDataSource.query(
      'SELECT user_id FROM app_monitor_user WHERE device_id = $1',
      [api.deviceId],
    )
    expect(bindRows[0].user_id).toBe(fixture!.userId)

    // 登出上报：auth=false 且不带 userId —— P2-31 前 null 被 nil 过滤丢弃，user_id 残留
    const stateOff = await api.anon('POST', api.apiPath('/app/monitor/user/state'), makeMonitorState({
      visitorId: api.fingerprint,
      auth: false,
    }))
    expectOk(stateOff, 'monitor user state auth=false')

    const rows: Array<{ user_id: string | null, auth: boolean }> = await api.pgDataSource.query(
      'SELECT user_id, auth FROM app_monitor_user WHERE device_id = $1',
      [api.deviceId],
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

    // monitor 行绑定受害者设备（B6：行键 = 调用方 cookie 里的 deviceId）
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

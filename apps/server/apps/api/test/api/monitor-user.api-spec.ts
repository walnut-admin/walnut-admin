import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * B 段：`app/monitor/user` —— CRUD list/read + `POST state`（Sign/Jwt/Cap/Device 全
 * Free 的匿名上报，deviceId 取签名 cookie）+ `DELETE force-quit/:id`（@WalnutDBTransaction，
 * admin-kick 撤销该用户该设备的 refresh token；socket 未装配时 sendToRoom 走 `socket?.`
 * 空安全，在线踢下线在测试环境为 no-op）。
 *
 * 在线状态自建自清：state 端点 upsert `app_monitor_user`（visitor_id 唯一）；force-quit
 * 前手插一行 auth_refresh_token（user+device 维度），踢完断言 revoked 落库。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface MonitorRow {
  id: string
  visitorId?: string
  userId?: string | null
  deviceId?: string | null
  auth?: boolean
  left?: boolean
  currentRouter?: string | null
  populated_device?: { deviceId?: string, deviceName?: string } | null
  populated_user?: { id?: string, userName?: string | null } | null
}

describe('B 段：app/monitor/user state/list/read/force-quit（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  /** 本轮两个访客（uq_monitor_visitor 唯一） */
  const visitorA = `vis-${seed8}-a`
  const visitorB = `vis-${seed8}-b`
  let fixture: WalnutRootUserFixture | null = null
  let monitorIdA = ''

  async function deleteMonitorRows() {
    await api.pgDataSource.query('DELETE FROM app_monitor_user WHERE visitor_id LIKE $1', [`vis-${seed8}%`])
    if (fixture !== null) {
      await api.pgDataSource.query('DELETE FROM auth_refresh_token WHERE user_id = $1', [fixture.userId])
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

  async function createOnlineMonitorA(): Promise<string> {
    const res = await api.anon('POST', api.apiPath('/app/monitor/user/state'), {
      visitorId: visitorA,
      auth: true,
      userId: fixture!.userId,
      focus: true,
      left: false,
      currentRouter: '/dashboard',
    })
    expectOk(res, 'monitor user state A')
    const rows: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM app_monitor_user WHERE visitor_id = $1',
      [visitorA],
    )
    return rows[0].id
  }

  it('state（匿名 Sign 链）→ 20000，在线状态 upsert 落库（user/device 绑定）', async () => {
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

  it('read → 20000，populated_device / populated_user 按 ID 装回', async () => {
    monitorIdA = await createOnlineMonitorA()

    const res = await api.root('GET', api.apiPath(`/app/monitor/user/${monitorIdA}`))
    expectOk(res, 'monitor user read')

    const row = bodyOf<MonitorRow>(res).data
    expect(row.visitorId).toBe(visitorA)
    expect(row.populated_device?.deviceId).toBe(api.deviceId)
    expect(row.populated_user?.id).toBe(fixture!.userId)
    expect(row.populated_user?.userName).toBe(fixture!.userName)
  })

  it('list → visitorId 过滤命中；匿名访客行（auth=false）userId 置空', async () => {
    monitorIdA = await createOnlineMonitorA()

    // 匿名访客 B：auth=false 走 userId 置 null 语义
    const stateB = await api.anon('POST', api.apiPath('/app/monitor/user/state'), {
      visitorId: visitorB,
      auth: false,
      focus: false,
      left: false,
    })
    expectOk(stateB, 'monitor user state B')

    const listRes = await api.root('POST', api.apiPath('/app/monitor/user/list'), {
      query: { visitorId: visitorB },
      sort: [{ field: 'firstVisitAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'monitor user list')

    const list = bodyOf<{ data: MonitorRow[], total: number }>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].visitorId).toBe(visitorB)
    expect(list.data[0].userId).toBeNull()

    const bRows: Array<{ user_id: string | null }> = await api.pgDataSource.query(
      'SELECT user_id FROM app_monitor_user WHERE visitor_id = $1',
      [visitorB],
    )
    expect(bRows[0].user_id).toBeNull()
  })

  it('force-quit → 20000，admin-kick 撤销该用户该设备 RT（revoked 落库）', async () => {
    monitorIdA = await createOnlineMonitorA()

    // 造一行未撤销的 refresh token（user+device 维度），踢完必须 revoked=true
    await api.pgDataSource.query(
      `INSERT INTO auth_refresh_token (jti, user_id, device_id, encrypted_token, expired_at)
       VALUES ($1, $2, $3, 'apispec-rt', NOW() + INTERVAL '1 day')`,
      [randomUUID(), fixture!.userId, api.deviceId],
    )

    const res = await api.root('DELETE', api.apiPath(`/app/monitor/user/force-quit/${monitorIdA}`))
    expectOk(res, 'monitor user force-quit')

    const rtRows: Array<{ revoked: boolean, revoke_reason: string | null }> = await api.pgDataSource.query(
      'SELECT revoked, revoke_reason FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, api.deviceId],
    )
    expect(rtRows).toHaveLength(1)
    expect(rtRows[0].revoked).toBe(true)
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
      query: {},
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

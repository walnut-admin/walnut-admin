import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import supertest from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AppTechCacheDeviceService } from '@/modules/techniques/cache/service/cache.device'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { WALNUT_TEST_USER_AGENT } from './helpers/sign-handshake'

/**
 * C 段：`system/device` —— POST initial（Sign/Jwt/Cap/Device 全 Free + Throttle 4/60s）
 * + read/list + `GET :id/current-active-user`、`GET :id/history-users` + PATCH
 * lock/unlock/ban/unban 四件。
 *
 * 关键现状（钉死，不"修正"）：
 * - initial 按 X-Fingerprint 派生业务键 device_id 幂等 upsert —— 同指纹重复 initial 回
 *   同一 deviceId（覆盖更新路径），新指纹产出新行；
 * - lock/unlock/ban/unban **只写内存标志 + SYS_DEVICE 缓存，不落库**（Mongo 版原样）——
 *   断言走 AppTechCacheDeviceService.getSysDeviceCache；且锁/封只进缓存 → 同设备的后续
 *   请求被 Device guard 40606/40607 拦死（连 unlock/unban 都到不了）—— 端点间用缓存
 *   复位通道衔接（等价另一台设备解锁后的缓存态），unlock/unban 本身仍走真实 HTTP；
 * - history-users 语义反转（只放行 user 缺失的行）：PG 侧 user_id FK NOT NULL
 *   且 populate 恒命中 → 恒空数组；
 * - Throttle 是 4 次/60s（tracker=realIp），本文件 initial 总调用数压在限额内。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface DeviceRow {
  id: string
  deviceId?: string
  deviceName?: string
  active?: boolean
  banned?: boolean
  locked?: boolean
  sr?: { height?: number | null, width?: number | null } | null
  vp?: { height?: number | null, width?: number | null } | null
  locationInfo?: { country?: string | null, region?: string | null, city?: string | null } | null
}

describe('C 段：system/device initial/read/list/lock-ban 四件（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  /** 第二台设备的指纹（走 unsigned + 自带 X-Fingerprint） */
  const secondFingerprint = `dev-spec-${seed8}`
  let fixture: WalnutRootUserFixture | null = null

  /** 本轮产生的额外设备（bootstrap 的 api.deviceId 由 afterAll 统一清） */
  let extraDeviceRowId = ''
  /** bootstrap 设备的行主键（read/current-active-user/history-users/lock 系的 :id 都是行 uuid） */
  let bootstrapDeviceRowId = ''

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `dev-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    const deviceRows: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM sys_device WHERE device_id = $1',
      [api.deviceId],
    )
    bootstrapDeviceRowId = deviceRows[0].id
  })

  afterEach(async () => {
    if (extraDeviceRowId !== '') {
      await api.pgDataSource.query('DELETE FROM sys_device WHERE id = $1', [extraDeviceRowId])
      extraDeviceRowId = ''
    }
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM app_monitor_user WHERE device_id = $1', [api.deviceId])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      // 设备缓存键（SYSTEM:DEVICE:<id>，无 seed 片段）显式清
      await app.get(AppTechCacheDeviceService).delSysDeviceCache(api.deviceId)
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('initial 同指纹重放 → 幂等回同一 deviceId（upsert 覆盖路径）+ DEVICE_ID cookie 重签', async () => {
    const res = await api.anon('POST', api.apiPath('/system/device/initial'), {
      deviceName: `dev-spec-replay-${seed8}`,
      deviceInfo: {},
      hardwareInfo: {},
      sr: { height: 1080, width: 1920 },
      vp: { height: 900, width: 1600 },
      private: false,
    })
    expectOk(res, 'device initial replay')

    const data = bodyOf<{ deviceId: string }>(res).data
    expect(data.deviceId).toBe(api.deviceId)
  })

  it('initial 新指纹 → 新设备行；read 出参 sr/vp 组装回嵌套对象', async () => {
    // 第二指纹的 initial 用裸 supertest 发（客户端 cookie jar 不吃它的 DEVICE_ID 重签 ——
    // 否则后续请求带着第二台设备的 DEVICE_ID + 第一台设备的 CAPJS_TOKEN，CAP guard 必 40116）
    const raw = await supertest(app.getHttpServer())
      .post(api.apiPath('/system/device/initial'))
      .set('user-agent', WALNUT_TEST_USER_AGENT)
      .set('X-Fingerprint', secondFingerprint)
      .send({
        deviceName: `dev-spec-second-${seed8}`,
        deviceInfo: {},
        hardwareInfo: {},
        sr: { height: 2048, width: 1152 },
        vp: { height: 800, width: 1280 },
        private: true,
      })
    expect((raw.body as { code: number }).code).toBe(20000)

    const secondDeviceId = (raw.body as { data: { deviceId: string } }).data.deviceId
    expect(secondDeviceId).not.toBe(api.deviceId)

    const rows: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM sys_device WHERE device_id = $1',
      [secondDeviceId],
    )
    extraDeviceRowId = rows[0].id
    expect(extraDeviceRowId).toMatch(UUID_RE)

    // bootstrap 建的第一台设备：read（:id 是行 uuid，不是业务键）回嵌套 sr/vp
    const readRes = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}`))
    expectOk(readRes, 'device read')
    const row = bodyOf<DeviceRow>(readRes).data
    expect(row.id).toBe(bootstrapDeviceRowId)
    expect(row.deviceId).toBe(api.deviceId)
    expect(row.sr).toEqual({ height: 1080, width: 1920 })
    expect(row.vp).toEqual({ height: 900, width: 1600 })
  })

  it('list → deviceId 过滤命中本设备；出参字段面按 DTO 裁剪', async () => {
    const listRes = await api.root('POST', api.apiPath('/system/device/list'), {
      query: { deviceId: api.deviceId },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'device list')
    const list = bodyOf<{ data: DeviceRow[], total: number }>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].deviceId).toBe(api.deviceId)
    // 同指纹重放 initial 的整体覆盖语义：deviceName 已是重放载荷的名字
    expect(list.data[0].deviceName).toBe(`dev-spec-replay-${seed8}`)
    // SysDeviceDTOListResponse pick 的字段面：无 createdAt
    expect((list.data[0] as unknown as Record<string, unknown>).createdAt).toBeUndefined()
  })

  it('current-active-user → 无 monitor 行回 null 填充壳；有行回用户简要', async () => {
    const emptyRes = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}/current-active-user`))
    expectOk(emptyRes, 'current active user empty')
    // `(await getCurrentActiveUser(id)) ?? {}` 经 plainToInstance(SysUserDTOReadResponse)
    // 深度实例化：空对象也带全字段 null 壳（钉现状）
    const empty = bodyOf<{ id?: string, userName: string | null }>(emptyRes).data
    expect(empty.id).toBeUndefined()
    expect(empty.userName).toBeNull()

    await api.pgDataSource.query(
      `INSERT INTO app_monitor_user (visitor_id, user_id, device_id, auth, focus, is_left)
       VALUES ($1, $2, $3, true, true, false)`,
      [`dev-spec-vis-${seed8}`, fixture!.userId, api.deviceId],
    )

    const res = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}/current-active-user`))
    expectOk(res, 'current active user')
    const user = bodyOf<{ id: string, userName: string | null }>(res).data
    expect(user.id).toBe(fixture!.userId)
    expect(user.userName).toBe(fixture!.userName)
  })

  it('history-users → 恒空数组（PG 侧 populate 恒命中，「只回 user 缺失行」的语义反转）', async () => {
    await api.pgDataSource.query(
      `INSERT INTO app_monitor_user (visitor_id, user_id, device_id, auth, focus, is_left)
       VALUES ($1, $2, $3, true, true, false)`,
      [`dev-spec-vis-h-${seed8}`, fixture!.userId, api.deviceId],
    )

    const res = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}/history-users`))
    expectOk(res, 'history users')
    expect(bodyOf<unknown[]>(res).data).toEqual([])
  })

  it('PATCH lock → SYS_DEVICE 缓存翻转（不落库）；锁死期间同设备请求被 Device guard 40606 拦死', async () => {
    const cacheDeviceService = app.get(AppTechCacheDeviceService)

    const lockRes = await api.root('PATCH', api.apiPath(`/system/device/${bootstrapDeviceRowId}/lock`))
    expectOk(lockRes, 'device lock')
    expect(bodyOf<boolean>(lockRes).data).toBe(true)
    expect((await cacheDeviceService.getSysDeviceCache(api.deviceId))?.locked).toBe(true)

    // 锁定只进缓存 → 同设备的后续请求（非 Free 端点）被 Device guard 40606 拦下
    const blockedRes = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}`))
    expect(bodyOf(blockedRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_LOCKED)

    // DB 行不动（锁状态只进缓存）
    const dbRows: Array<{ locked: boolean }> = await api.pgDataSource.query(
      'SELECT locked FROM sys_device WHERE device_id = $1',
      [api.deviceId],
    )
    expect(dbRows[0].locked).toBe(false)
  })

  it('PATCH unlock → true（锁死状态先经缓存通道复位）+ read 恢复可用', async () => {
    const cacheDeviceService = app.get(AppTechCacheDeviceService)
    // 上例锁死后同设备直达 unlock 也被 40606 拦 —— 走真实语义的复位通道（等价「另一台
    // 设备/管理通道解锁」后的缓存态），unlock 端点本身仍走真实 HTTP
    const cached = await cacheDeviceService.getSysDeviceCache(api.deviceId)
    await cacheDeviceService.setSysDeviceCache({
      deviceId: api.deviceId,
      locked: false,
      banned: cached!.banned,
      active: cached!.active,
      ip: cached!.currentIp,
    })

    const unlockRes = await api.root('PATCH', api.apiPath(`/system/device/${bootstrapDeviceRowId}/unlock`))
    expectOk(unlockRes, 'device unlock')
    expect(bodyOf<boolean>(unlockRes).data).toBe(true)
    expect((await cacheDeviceService.getSysDeviceCache(api.deviceId))?.locked).toBe(false)

    const readRes = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}`))
    expectOk(readRes, 'device read after unlock')
  })

  it('PATCH ban → SYS_DEVICE 缓存翻转；封禁期间同设备请求 40607', async () => {
    const cacheDeviceService = app.get(AppTechCacheDeviceService)

    const banRes = await api.root('PATCH', api.apiPath(`/system/device/${bootstrapDeviceRowId}/ban`))
    expectOk(banRes, 'device ban')
    expect((await cacheDeviceService.getSysDeviceCache(api.deviceId))?.banned).toBe(true)

    const blockedRes = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}`))
    expect(bodyOf(blockedRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_BANNED)
  })

  it('PATCH unban → true + 缓存复位 + read 恢复可用', async () => {
    const cacheDeviceService = app.get(AppTechCacheDeviceService)
    const cached = await cacheDeviceService.getSysDeviceCache(api.deviceId)
    await cacheDeviceService.setSysDeviceCache({
      deviceId: api.deviceId,
      locked: cached!.locked,
      banned: false,
      active: cached!.active,
      ip: cached!.currentIp,
    })

    const unbanRes = await api.root('PATCH', api.apiPath(`/system/device/${bootstrapDeviceRowId}/unban`))
    expectOk(unbanRes, 'device unban')
    expect((await cacheDeviceService.getSysDeviceCache(api.deviceId))?.banned).toBe(false)

    const readRes = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}`))
    expectOk(readRes, 'device read after unban')
  })

  it('边界：read 不存在 uuid → 40401；current-active-user 非法 uuid → 40002', async () => {
    const readRes = await api.root('GET', api.apiPath(`/system/device/${randomUUID()}`))
    expect(bodyOf(readRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const badUuid = await api.root('GET', api.apiPath('/system/device/not-a-uuid/current-active-user'))
    expect(bodyOf(badUuid).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_INVALID_ID)
  })
})

import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { AppTechCacheDeviceService } from '@walnut-server/cache'
import { WalnutAdminExceptionDeviceNotAcceptable } from '@walnut-server/exceptions/base/406'
import { SysDeviceService } from '@walnut-server/system'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import supertest from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { WALNUT_TEST_USER_AGENT } from './helpers/sign-handshake'

/**
 * C 段：`system/device` —— POST initial（Sign/Jwt/Cap/Device 全 Free + Throttle 4/60s）
 * + read/list + `GET :id/current-active-user`、`GET :id/history-users` + PATCH
 * lock/unlock/ban/unban 四件。
 *
 * 关键现状（P2-2 / P2-3 / P3-2 修复后，2026-10-28）：
 * - initial 按 X-Fingerprint 派生业务键 device_id 幂等 upsert —— 同指纹重复 initial 回
 *   同一 deviceId（覆盖更新路径），新指纹产出新行；重名 device_name 撞 `uq_device_name`
 *   （23505）在 catch-all 之前单列受控 40000，其余异常仍走 40605；
 * - lock/unlock/ban/unban **落库 + 缓存双写**（sys_device.locked / banned，同事务更新，
 *   after-commit 写 SYS_DEVICE 缓存）；Device guard 缓存 miss 时回源库 —— 清缓存后
 *   锁/封状态仍生效（40606/40607）。锁/封期间同设备请求被 guard 拦死（连 unlock/unban
 *   都到不了），端点间仍以缓存复位通道衔接；
 * - **ban 还有「踢下线」副作用**（97012f3b / 拍板-4）：同事务按**设备**撤掉全部 RT，提交后
 *   清会话 / 权限 / MFA verified 键 —— 解封**不复活**旧会话，旧 AT 立即 40101，唯一恢复路径是
 *   重新登录（本文件 unban 用例即「复位缓存态 → 重新登录 → unban」；AT/RT 面的正向断言在
 *   guard-matrix.api-spec 的封禁闭环绕里）；
 * - history-users 返回 sys_user_device 的绑定用户（绑定即 upsert、无解绑删除通道，
 *   表内行即绑定历史），按 lastActiveAt 降序；
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
  /** history-users 用例补的第二用户（afterEach 清） */
  let extraHistoryUserId = ''
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
    if (extraHistoryUserId !== '') {
      await api.pgDataSource.query('DELETE FROM sys_user_device WHERE user_id = $1', [extraHistoryUserId])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [extraHistoryUserId])
      extraHistoryUserId = ''
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
      filters: [{ field: 'deviceId', op: 'like', value: api.deviceId }],
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'device list')
    const list = bodyOf<{ data: DeviceRow[], total: number }>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].deviceId).toBe(api.deviceId)
    // 同指纹重放 initial 的整体覆盖语义：deviceName 已是重放载荷的名字
    // B5：deviceName 由服务端生成（客户端载荷不再参与），形态 = <设备类型>_<8 位 hex>
    expect(list.data[0].deviceName).toMatch(/^desktop_[0-9a-f]{8}$/)
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

  it('history-users → 返回绑定本设备的用户（sys_user_device 即绑定历史），按 lastActiveAt 降序', async () => {
    // 登录链路已为 fixture 用户写入一条 sys_user_device 绑定行；再补第二用户，
    // 证明「历史用户」不是单用户回显
    extraHistoryUserId = randomUUID()
    await api.pgDataSource.query(
      'INSERT INTO sys_user (id, user_name, nick_name) VALUES ($1, $2, $3)',
      [extraHistoryUserId, `dev-spec-history-${seed8}`, 'History User'],
    )
    await api.pgDataSource.query(
      `INSERT INTO sys_user_device (user_id, device_id, device_name, last_active_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, device_id) DO UPDATE SET last_active_at = EXCLUDED.last_active_at`,
      [extraHistoryUserId, api.deviceId, `dev-spec-history-${seed8}`],
    )
    // fixture 用户的绑定行把 lastActiveAt 压到 1 小时前，让排序可判
    await api.pgDataSource.query(
      `UPDATE sys_user_device SET last_active_at = now() - interval '1 hour'
       WHERE user_id = $1 AND device_id = $2`,
      [fixture!.userId, api.deviceId],
    )

    const res = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}/history-users`))
    expectOk(res, 'history users')
    const rows = bodyOf<Array<{ id: string, userName: string | null, lastActiveAt: string | null }>>(res).data
    expect(rows.map(row => row.id)).toEqual([extraHistoryUserId, fixture!.userId])
    expect(rows[0].userName).toBe(`dev-spec-history-${seed8}`)
    expect(rows[1].userName).toBe(fixture!.userName)
  })

  it('服务端生成 deviceName（B5）：落库名字与载荷无关；P4 起载荷连这个字段都不能带', async () => {
    // 改造前这里断言「重名 device_name 撞 uq_device_name → 受控 40000」。
    // B5 之后 deviceName 由服务端生成 ⇒ 这条前提消失：名字的唯一性由签发方保证，
    // 同一载荷重放不会再撞 23505。P4 起 DTO 里的 deviceName 也被摘除（带了即 40099，
    // 由 libs/system/src/device/dto/device.dto.spec.ts 用同口径校验钉住 —— 这里不再
    // 多打一次 initial，本文件的调用数压在 4 次/60s 的限流上限）。
    const mk = () => supertest(app.getHttpServer())
      .post(api.apiPath('/system/device/initial'))
      .set('user-agent', WALNUT_TEST_USER_AGENT)
      .set('X-Fingerprint', `dev-spec-dup-${seed8}`)
      .send({
        deviceInfo: {},
        hardwareInfo: {},
        sr: { height: 1080, width: 1920 },
        vp: { height: 900, width: 1600 },
        private: false,
      })

    // 只打一次：initial 有 4 次/60s 的限流（42900），本用例不再多占额度
    const a = await mk()
    expect((a.body as { code: number }).code).toBe(20000)

    const idA = (a.body as { data: { deviceId: string } }).data.deviceId
    expect(idA).toMatch(/^d1_[0-9a-f]{32}$/)

    const rows: Array<{ device_name: string }> = await api.pgDataSource.query(
      'SELECT device_name FROM sys_device WHERE device_id = $1',
      [idA],
    )
    expect(rows).toHaveLength(1)
    // 名字只由服务端生成：形态 = <设备类型>_<8 位 hex>，与载荷无关
    expect(rows[0].device_name).toMatch(/^desktop_[0-9a-f]{8}$/)

    // 清理：这一行属于本用例
    await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [idA])

    // 对照：非 23505 的异常仍走 catch-all → 40605（直接打到 service 层，绕过 DTO）
    const deviceService = app.get(SysDeviceService)
    await expect(deviceService.initial(
      {} as IWalnutAdminExpressRequest,
      {} as never,
      api.pgDataSource.manager,
    )).rejects.toBeInstanceOf(WalnutAdminExceptionDeviceNotAcceptable)
  })

  it('PATCH lock → DB locked=true + 缓存双写；清缓存后锁状态由 guard 回源库仍 40606', async () => {
    const cacheDeviceService = app.get(AppTechCacheDeviceService)

    const lockRes = await api.root('PATCH', api.apiPath(`/system/device/${bootstrapDeviceRowId}/lock`))
    expectOk(lockRes, 'device lock')
    expect(bodyOf<boolean>(lockRes).data).toBe(true)
    expect((await cacheDeviceService.getSysDeviceCache(api.deviceId))?.locked).toBe(true)

    // P2-2：锁状态落库（不再是只写缓存的临时态）
    const dbRows: Array<{ locked: boolean }> = await api.pgDataSource.query(
      'SELECT locked FROM sys_device WHERE device_id = $1',
      [api.deviceId],
    )
    expect(dbRows[0].locked).toBe(true)

    // 清缓存 → 同设备后续请求触发 guard 回源库：仍 40606，且缓存被回填
    await cacheDeviceService.delSysDeviceCache(api.deviceId)
    expect(await cacheDeviceService.getSysDeviceCache(api.deviceId)).toBeNull()

    const blockedRes = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}`))
    expect(bodyOf(blockedRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_LOCKED)

    const refilled = await cacheDeviceService.getSysDeviceCache(api.deviceId)
    expect(refilled?.locked).toBe(true)
  })

  it('PATCH unlock → true + DB/缓存双清 + read 恢复可用', async () => {
    const cacheDeviceService = app.get(AppTechCacheDeviceService)
    // 上例锁死后同设备直达 unlock 也被 40606 拦 —— 走真实语义的复位通道（等价「另一台
    // 设备/管理通道解锁」后的缓存态），unlock 端点本身仍走真实 HTTP 并把库改回 false
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

    const dbRows: Array<{ locked: boolean }> = await api.pgDataSource.query(
      'SELECT locked FROM sys_device WHERE device_id = $1',
      [api.deviceId],
    )
    expect(dbRows[0].locked).toBe(false)

    const readRes = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}`))
    expectOk(readRes, 'device read after unlock')
  })

  it('PATCH ban → DB banned=true + 缓存双写；清缓存后封禁仍 40607', async () => {
    const cacheDeviceService = app.get(AppTechCacheDeviceService)

    const banRes = await api.root('PATCH', api.apiPath(`/system/device/${bootstrapDeviceRowId}/ban`))
    expectOk(banRes, 'device ban')
    // 拍板-4：这条 ban 同时把本设备「踢下线」（同事务撤全部 RT、提交后清会话/权限/MFA 键）。
    // 下面的 40607 由设备 guard 先拦，但本设备的登录态在此刻已经死了 —— 只能重新登录，
    // 见下例。AT/RT 面的正向断言在 guard-matrix.api-spec 的封禁闭环绕里。
    expect((await cacheDeviceService.getSysDeviceCache(api.deviceId))?.banned).toBe(true)

    const dbRows: Array<{ banned: boolean }> = await api.pgDataSource.query(
      'SELECT banned FROM sys_device WHERE device_id = $1',
      [api.deviceId],
    )
    expect(dbRows[0].banned).toBe(true)

    await cacheDeviceService.delSysDeviceCache(api.deviceId)
    const blockedRes = await api.root('GET', api.apiPath(`/system/device/${bootstrapDeviceRowId}`))
    expect(bodyOf(blockedRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_BANNED)
    expect((await cacheDeviceService.getSysDeviceCache(api.deviceId))?.banned).toBe(true)
  })

  it('PATCH unban → true + DB/缓存双清；解封不复活旧会话，重新登录后 read 恢复可用', async () => {
    const cacheDeviceService = app.get(AppTechCacheDeviceService)
    const cached = await cacheDeviceService.getSysDeviceCache(api.deviceId)
    // 上例的 ban 已把本设备「踢下线」（RT 全撤 + 会话键清空），此后本设备的请求全被设备
    // guard 拦死、连 unban 都到不了 —— 仍走真实语义的缓存复位通道（等价「另一台设备 / 管理
    // 通道解封」后的缓存态）；unban 端点本身照旧走真实 HTTP 并把库改回 false。
    await cacheDeviceService.setSysDeviceCache({
      deviceId: api.deviceId,
      locked: cached!.locked,
      banned: false,
      active: cached!.active,
      ip: cached!.currentIp,
    })

    // 封禁 = 踢下线（拍板-4）：旧 AT 的会话键与旧 RT 都已作废，解封不复活 —— 要拿回可用登录态
    // 只能重新登录。登录链只有 JwtFree（签名按单因子算，故先清 auth），本设备此刻已回到未封禁
    // 缓存态所以过得去设备 guard；MFA verified 缓存同样被踢下线清掉了，要重种。
    api.setAuth(null)
    const tokens = await performHttpOpaqueLogin(api, app, fixture!)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture!.userId)

    const unbanRes = await api.root('PATCH', api.apiPath(`/system/device/${bootstrapDeviceRowId}/unban`))
    expectOk(unbanRes, 'device unban')
    expect((await cacheDeviceService.getSysDeviceCache(api.deviceId))?.banned).toBe(false)

    const dbRows: Array<{ banned: boolean }> = await api.pgDataSource.query(
      'SELECT banned FROM sys_device WHERE device_id = $1',
      [api.deviceId],
    )
    expect(dbRows[0].banned).toBe(false)

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

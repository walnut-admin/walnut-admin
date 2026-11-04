import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import { ConfigService } from '@nestjs/config'
import { AppTechCacheDeviceService, AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys, WalnutAdminConstDeviceCookieMaxAge } from '@walnut-server/const/app/cookie'
import { isValidDeviceId } from '@walnut-server/system'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'
import { signCookieValue, unsignCookieValue } from '../../helpers/signed-cookie'

/**
 * B 路 · Device 家族：Device guard 的**接口级**现状与两条零覆盖的修复腿（真实 HTTP 全链）。
 *
 * 与既有覆盖的分工：
 * - `system/device/device.api-spec.ts`：initial / read / list / lock-ban 四件的业务面；
 * - `platform/guard-matrix.api-spec.ts`：封禁/锁定拒绝面 40606/40607、单测级形态判据、
 *   以及 G8「IP 变化顺序 3 次请求」；
 * - `libs/guards/.../device.guard.spec.ts`（本批新增）：guard 单测（短路 / 形态 / 回源 / 续期窗口）；
 * - 本文件补的是**只有真实 HTTP + 真 cookie 签名才拿得到**的四条：
 *
 * 1. **P0-1 滑动续期（此前零覆盖）**：删掉续期时间闸 ⇒ 请求必须带 `Set-Cookie: DEVICE_ID`；
 *    紧接着第二次**不**再带（证明窗口标记真的生效）。这是「第 31 天全站 40605、连登录都进不去」
 *    那条死锁的后端修复 —— 破了它没有任何用例会红。
 * 2. **签名有效 + 库里没有行 ⇒ 40605**（`device.guard.ts:115-121`）：用 `signCookieValue`
 *    签一枚签名合法、形态合法、服务端却查不到行的值。「90 天 purge 删了行 + 浏览器 cookie 还在」
 *    就是这个真实用户态。带 A/B 对照：同一条 cookie 在行还在时**不是** 40605。
 * 3. **`sys_device.active = false` 分支现状（按现状钉住，不是期望）**：guard 只判 banned/locked，
 *    `active` 进缓存但无人消费 ⇒ 仍放行 20000。注释里写明这是现状。
 * 4. **IP 变化的 murlock 去重**：同一 (deviceId, 新 IP) 并发 3 路 ⇒ locationHistory 只写一条。
 *    （G8 覆盖的是顺序 3 次；并发才是锁 + 锁内复核真正要挡住的读改写丢失。）
 *
 * 全部断言只读**可观测行为**：`body.code` 精确值 / `Set-Cookie` / PG 行 / Redis 键。
 * 时间语义只用「续期窗口开/关」这种配置量（maxAge 的 80%），没有 `Date.now()` 差值判据。
 */

/** 续期时间闸的逻辑键（与 `AppTechCacheDeviceService.markDeviceCookieRenewed` 同口径） */
const renewKeyOf = (deviceId: string) => `${WalnutAdminConstAppCacheKeys.SYS_DEVICE_COOKIE_RENEW}:${deviceId}`

/** 新 IP 取回环段（`is-localhost-ip` ⇒ LOCAL）：不触发外网 geoip，用例确定性 */
const CONCURRENT_NEW_IP = '127.0.0.3'

interface IDeviceIpState {
  ip: string | null
  ipHistory: string[]
  locationHistory: Array<{ ip?: string }>
}

describe('B 路 · Device 家族：滑动续期 / 签名有效但无行 / active 现状 / IP 变化并发去重（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  /** 主客户端：带完整登录态，用来打「全链通过」的端点 */
  let api: WalnutApiClient
  /**
   * 第二台设备（真服务端签发 + 真 cookie 签名 + 自己的握手态），
   * 专供「签名合法但库里没有行」用 —— 主设备的行不能被删掉。
   */
  let apiGhost: WalnutApiClient

  let fixture: WalnutRootUserFixture | null = null
  let cache: AppTechCacheService
  let cacheDevice: AppTechCacheDeviceService
  let cookieSecret: string
  /** bootstrap 设备的行主键（read 的 `:id` 是行 uuid，不是业务键） */
  let deviceRowId = ''

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    apiGhost = await WalnutApiClient.create(app)

    cache = app.get(AppTechCacheService)
    cacheDevice = app.get(AppTechCacheDeviceService)
    cookieSecret = app.get(ConfigService).get<string>('app.cookie.secret')!

    fixture = await registerRootUserFixture(app, api.pgDataSource, 'dvg')
    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    const deviceRows: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM sys_device WHERE device_id = $1',
      [api.deviceId],
    )
    deviceRowId = deviceRows[0].id
  })

  afterAll(async () => {
    if (api !== undefined) {
      const pg = api.pgDataSource
      const deviceIds = [api.deviceId, apiGhost?.deviceId].filter((id): id is string => typeof id === 'string' && id.length > 0)

      if (fixture !== null) {
        await pg.query('DELETE FROM app_monitor_user WHERE device_id = $1', [api.deviceId])
        await pg.query('DELETE FROM sys_user_device WHERE user_id = $1', [fixture.userId])
        await pg.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
        await pg.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      }

      for (const deviceId of deviceIds) {
        await pg.query('DELETE FROM sys_device WHERE device_id = $1', [deviceId])
        await cacheDevice.delSysDeviceCache(deviceId)
      }

      await api.cleanupWalnutCacheKeys(...deviceIds)
      if (fixture !== null) {
        await api.cleanupWalnutCacheKeys(fixture.userId)
      }
    }

    await app?.close()
  })

  /** 从响应的 Set-Cookie 里挑出某键的**裸值**（去掉属性段） */
  function cookieValueFromResponse(res: SuperTestResponse, key: string): string | undefined {
    const setCookies = (res.headers['set-cookie'] ?? []) as unknown as string[]
    const raw = setCookies.find(item => item.startsWith(`${key}=`))
    return raw?.split(';')[0].slice(key.length + 1)
  }

  /** 从响应的 Set-Cookie 里挑出某键的属性表（小写键名，值原样） */
  function cookieAttributesFromResponse(res: SuperTestResponse, key: string): Record<string, string> {
    const setCookies = (res.headers['set-cookie'] ?? []) as unknown as string[]
    const raw = setCookies.find(item => item.startsWith(`${key}=`))

    if (raw === undefined) {
      return {}
    }

    const attributes: Record<string, string> = {}
    for (const part of raw.split(';').slice(1)) {
      const eq = part.indexOf('=')
      if (eq === -1) {
        attributes[part.trim().toLowerCase()] = ''
      }
      else {
        attributes[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1)
      }
    }
    return attributes
  }

  async function readIpState(deviceId: string): Promise<IDeviceIpState> {
    const rows: Array<{ ip: string | null, ip_history: string[] | null, location_history: Array<{ ip?: string }> | null }>
      = await api.pgDataSource.query(
        'SELECT ip, ip_history, location_history FROM sys_device WHERE device_id = $1',
        [deviceId],
      )

    return {
      ip: rows[0].ip,
      ipHistory: rows[0].ip_history ?? [],
      locationHistory: rows[0].location_history ?? [],
    }
  }

  // ==========================================================================
  // 1. P0-1 滑动续期（此前零覆盖）
  // ==========================================================================
  describe('P0-1：DEVICE_ID cookie 滑动续期（窗口闸）', () => {
    it('删掉续期标记 ⇒ 请求带 Set-Cookie DEVICE_ID（maxAge 拉满）；紧接着第二次不再带', async () => {
      const renewKey = renewKeyOf(api.deviceId)
      await cache.del(renewKey)
      expect(await api.hasWalnutCacheKey(renewKey)).toBe(false)

      // —— 第一次：窗口是开的（标记不存在 ⇒ 距上次续期已超过间隔）——
      const first = await api.root('GET', api.apiPath(`/system/device/${deviceRowId}`))
      expectOk(first, 'renewal request #1')

      const renewedRaw = cookieValueFromResponse(first, WalnutAdminConstCookieKeys.DEVICE_ID)
      expect(renewedRaw).toBeTruthy()
      // 下发的就是本设备的 id（解签名后逐字节相同），不是「随便重签一枚」
      expect(unsignCookieValue(renewedRaw!)).toBe(api.deviceId)
      // maxAge 与 /system/device/initial 同源：30 天的秒数
      expect(cookieAttributesFromResponse(first, WalnutAdminConstCookieKeys.DEVICE_ID)['max-age'])
        .toBe(String(WalnutAdminConstDeviceCookieMaxAge / 1000))

      // 副作用：时间闸被重新占位（键存在），于是窗口关闭
      expect(await api.hasWalnutCacheKey(renewKey)).toBe(true)

      // —— 第二次（紧接着）：窗口已关 ⇒ 不再重发 ——
      const second = await api.root('GET', api.apiPath(`/system/device/${deviceRowId}`))
      expectOk(second, 'renewal request #2')
      expect(cookieValueFromResponse(second, WalnutAdminConstCookieKeys.DEVICE_ID)).toBeUndefined()
    })

    it('反例：窗口没被清时（标记已在）不发 cookie —— 与上一条只差一次 del', async () => {
      // 上一条的第二次请求就是这个状态，这里显式再确认一次：键在 ⇒ 两次请求都不带 Set-Cookie
      expect(await api.hasWalnutCacheKey(renewKeyOf(api.deviceId))).toBe(true)

      for (let i = 0; i < 2; i++) {
        const res = await api.root('GET', api.apiPath(`/system/device/${deviceRowId}`))
        expectOk(res, `no-renewal request #${i + 1}`)
        expect(cookieValueFromResponse(res, WalnutAdminConstCookieKeys.DEVICE_ID)).toBeUndefined()
      }
    })
  })

  // ==========================================================================
  // 2. 签名合法 + 形态合法，但库里没有行 ⇒ 40605
  // ==========================================================================
  describe('签名有效但库里没有行 ⇒ 40605（90 天 purge + 浏览器 cookie 还在）', () => {
    it('helper 签的合法 cookie 在行还在时不是 40605；删掉 sys_device 行 + 缓存后同一枚 cookie 变 40605', async () => {
      const ghostDeviceId = apiGhost.deviceId
      // 前置：形态合法（否则 40605 会来自形态判据，测不到「查库查不到」那条分支）
      expect(isValidDeviceId(ghostDeviceId)).toBe(true)

      const rows: Array<{ id: string }> = await api.pgDataSource.query(
        'SELECT id FROM sys_device WHERE device_id = $1',
        [ghostDeviceId],
      )
      expect(rows).toHaveLength(1)

      // 把 ghost 客户端自己的 DEVICE_ID 换成 helper 手签的**同一值**：签名合法、内容合法
      const serverIssued = apiGhost.getCookie(WalnutAdminConstCookieKeys.DEVICE_ID)!
      const resigned = signCookieValue(cookieSecret, ghostDeviceId)
      expect(unsignCookieValue(resigned)).toBe(ghostDeviceId)
      apiGhost.setCookie(WalnutAdminConstCookieKeys.DEVICE_ID, resigned)

      // A 对照：行还在 ⇒ 设备 guard 通过，拒绝发生在更后面的 JWT（本客户端没有 AT）
      // —— 这一条同时自证 helper 的签名被真 cookie-parser 收下了（否则会因「缺失」直接 40605）
      const alive = await apiGhost.anon('GET', api.apiPath('/system/user/lock/read'))
      expect(bodyOf(alive).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

      // 模拟 90 天 purge：行没了；缓存一并清掉（真实的「缓存早已被淘汰/重启」那一半）
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [ghostDeviceId])
      await cacheDevice.delSysDeviceCache(ghostDeviceId)

      // B：同一枚 cookie，库里查不到行 ⇒ 40605（device.guard.ts:115-121）
      const gone = await apiGhost.anon('GET', api.apiPath('/system/user/lock/read'))
      expect(bodyOf(gone).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)

      // 副作用：回源失败不留半截状态 —— 缓存里仍是 miss（不放行、也不写空壳）
      expect(await cacheDevice.getSysDeviceCache(ghostDeviceId)).toBeNull()
      // 也没有反向「补建」一台设备
      const afterRows: Array<{ id: string }> = await api.pgDataSource.query(
        'SELECT id FROM sys_device WHERE device_id = $1',
        [ghostDeviceId],
      )
      expect(afterRows).toHaveLength(0)

      expect(serverIssued).toBeTruthy()
    })
  })

  // ==========================================================================
  // 3. active=false 分支现状（按现状钉住，不是期望）
  // ==========================================================================
  describe('sys_device.active = false 的现状（这是现状，不是期望）', () => {
    it('库里 active=false + 缓存清空 ⇒ 请求照常 20000；active 只被搬进缓存，没有任何 guard 消费它', async () => {
      // 读实现（device.guard.ts:150-158）：拒绝链只有 banned / locked 两条，
      // `active` 仅在「缓存 miss 回源」时被搬进缓存对象（第 129 行），之后无人读取。
      // 所以下面这条断言钉的是**现状**：把设备标成 inactive 并不能挡住它的请求。
      await api.pgDataSource.query('UPDATE sys_device SET active = false WHERE device_id = $1', [api.deviceId])
      // 清缓存，强制走「回源 ⇒ 读到 active=false」那条腿（否则测的还是缓存里的旧值）
      await cacheDevice.delSysDeviceCache(api.deviceId)
      expect(await cacheDevice.getSysDeviceCache(api.deviceId)).toBeNull()

      const res = await api.root('GET', api.apiPath(`/system/device/${deviceRowId}`))
      expectOk(res, 'inactive device request')

      // 回填的缓存里 active 确实是 false —— 字段被搬进来了，只是没人读（现状）
      expect(await cacheDevice.getSysDeviceCache(api.deviceId))
        .toMatchObject({ active: false, locked: false, banned: false })

      // 还原：本文件后续用例（IP 并发去重）需要一台正常在用的设备
      await api.pgDataSource.query('UPDATE sys_device SET active = true WHERE device_id = $1', [api.deviceId])
      await cacheDevice.delSysDeviceCache(api.deviceId)
    })
  })

  // ==========================================================================
  // 4. IP 变化的 murlock 去重（并发 3 路）
  // ==========================================================================
  describe('IP 变化的并发去重（APP:MURLOCK:DEVICE:IP_CHANGE）', () => {
    it('同一 (deviceId, 新 IP) 并发 3 路 ⇒ locationHistory / ipHistory 各只多一条', async () => {
      const before = await readIpState(api.deviceId)
      // 前置：新 IP 与当前 IP 不同（否则 guard 根本不进 IP 变化分支，用例会静默变成空转）
      expect(before.ip).not.toBe(CONCURRENT_NEW_IP)

      // 预热一格：上一条用例手工清过设备缓存，这里用一次「IP 未变」的请求把缓存回填成当前 IP，
      // 于是下面三路并发读到的是同一份旧状态（guard 的 IP 判定在锁外，三路都会尝试进临界区）
      expectOk(await api.root('GET', api.apiPath('/system/user/lock/read')), 'warm device cache')
      expect((await cacheDevice.getSysDeviceCache(api.deviceId))?.currentIp).toBe(before.ip)

      const responses = await Promise.all(
        [1, 2, 3].map(async () => api.root(
          'GET',
          api.apiPath('/system/user/lock/read'),
          undefined,
          { 'x-forwarded-for': CONCURRENT_NEW_IP },
        )),
      )

      // 三路都必须放行（锁到期/抢锁失败会变成 50000，不能只断言「有一路成功」）
      for (const [index, res] of responses.entries()) {
        expectOk(res, `concurrent ip-change request #${index + 1}`)
      }

      const after = await readIpState(api.deviceId)

      // 行上的 IP 已是新值（这一次写入是**唯一**一次）
      expect(after.ip).toBe(CONCURRENT_NEW_IP)
      // 去重判据：读改写只发生一次。若锁内复核失效，三路会各自 read-modify-write，
      // ipHistory / locationHistory 里就会出现 2~3 份同一个新 IP（丢失更新）。
      expect(after.ipHistory.filter(ip => ip === CONCURRENT_NEW_IP))
        .toHaveLength(before.ipHistory.filter(ip => ip === CONCURRENT_NEW_IP).length + 1)
      expect(after.locationHistory.filter(item => item.ip === CONCURRENT_NEW_IP))
        .toHaveLength(before.locationHistory.filter(item => item.ip === CONCURRENT_NEW_IP).length + 1)

      // 还原：不带 XFF 的一次请求把 IP 写回真实回环地址（避免污染后续用例的缓存/行状态）
      expectOk(await api.root('GET', api.apiPath('/system/user/lock/read')), 'ip restore')
    })
  })
})

import type { NestExpressApplication } from '@nestjs/platform-express'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'

import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AppTechCacheDeviceService, AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { generateDeviceId, SysDevicePgPurgeService } from '@walnut-server/system'
import { SystemEndpointRoutes } from '@walnut/contract'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import supertest from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { bodyOf } from '../../api/helpers/api-client'
import { apiPath, createApiApp, getWalnutPgAdminDataSource } from '../../api/helpers/create-api-app'
import { WALNUT_TEST_USER_AGENT } from '../../api/helpers/sign-handshake'
import { signCookieValue } from '../../api/helpers/signed-cookie'

/**
 * 90 天留存清理的**缓存半边**（on real PG + real HTTP）。
 *
 * 为什么单开一个文件：`device.purge.pg.int-spec.ts` 只钉「行删没删」（service 层），
 * 而留存策略真正失效的那一步在**缓存**上 ——
 *
 * 1. purge 在事务里删 `sys_device` + `app_monitor_user`，但**不失效**
 *    `SYSTEM:DEVICE:<deviceId>`（改前全仓只有测试调用 `delSysDeviceCache`）；
 * 2. `setSysDeviceCache` 写缓存不带 TTL（`cache.service.ts` 的 `No Expiration` 分支）；
 * 3. `device.guard.ts` 只在**缓存 miss** 时才回源库，「库里没有行 ⇒ 40605」要等
 *    Redis 淘汰/重启才走得到。
 *
 * ⇒ 被 purge 掉的设备只要缓存还在就继续放行。本文件的判据是**行为**：
 * **purge 之后不手工清缓存，同一枚 cookie 的请求也必须变 40605**。
 * 全文没有一处 `delSysDeviceCache` 用来「帮用例过关」（只在 afterAll 清理本文件自己的键、
 * 以及第二条用例里模拟失效失败）。
 */
const CRON_LOCK_KEY = 'CRON_LOCK:purgeInactiveDevices'

describe('SysDevicePgPurgeService：90 天留存清理必须连带失效设备缓存（on real PG + real HTTP）', () => {
  let app: NestExpressApplication
  /** 管理通道（fixture / 断言用；HTTP 仍走应用自己的 walnut_app 连接） */
  let pgDataSource: DataSource
  let purgeService: SysDevicePgPurgeService
  let cacheDeviceService: AppTechCacheDeviceService
  let cacheService: AppTechCacheService
  let cookieSecret: string
  /** 一个真正**受 device guard 保护**的端点（sign-free / jwt-free 的都不行） */
  let guardedPath: string

  const seed8 = randomUUID().slice(0, 8)
  const seededDeviceIds: string[] = []

  /**
   * 播一台「90 天无活动的沉默设备」：active=false + created/updated 都在 91 天前，
   * 没有 monitor 行、没有活 RT —— 与 `device.repo.service.purgeInactiveDevicesBefore`
   * 的谓词逐条对齐，保证它**确实**是本轮的删除目标。
   */
  async function seedExpiredDevice() {
    const deviceId = generateDeviceId()

    await pgDataSource.query(
      `INSERT INTO sys_device
         (device_name, device_id, device_info, ip_history, active, banned, locked, created_at, updated_at)
       VALUES ($1, $2, '{}'::jsonb, ARRAY[]::text[], false, false, false,
               now() - interval '91 days', now() - interval '91 days')`,
      [`purge-cache-${seed8}-${randomUUID().slice(0, 8)}`, deviceId],
    )

    seededDeviceIds.push(deviceId)
    return deviceId
  }

  async function exists(table: string, deviceId: string) {
    const rows: Array<{ c: number }> = await pgDataSource.query(
      `SELECT count(*)::int AS c FROM ${table} WHERE device_id = $1`,
      [deviceId],
    )
    return rows[0].c > 0
  }

  /**
   * 带**真签名** DEVICE_ID cookie 的真实 HTTP 请求。
   *
   * 刻意不带 CAP / X-Sign / Authorization：device guard 排在 Risk / CAP / JWT 之前
   * （app.module.ts 的 APP_GUARD 序），本文件要看的正是「device guard 这一层把不把得住」——
   * 后面几层返回什么码都行，**唯独 40605 只能来自 device guard**。
   * cookie 签名用 `app.cookie.secret` 手算（与 cookie-parser 的 sign 逐字节一致）。
   */
  function requestWithDevice(deviceId: string) {
    const signed = signCookieValue(cookieSecret, deviceId)

    return supertest(app.getHttpServer())
      .get(guardedPath)
      .set('user-agent', WALNUT_TEST_USER_AGENT)
      .set('X-Fingerprint', randomUUID())
      .set('Cookie', `${WalnutAdminConstCookieKeys.DEVICE_ID}=${encodeURIComponent(signed)}`)
  }

  beforeAll(async () => {
    app = await createApiApp()
    pgDataSource = getWalnutPgAdminDataSource(app)
    purgeService = app.get(SysDevicePgPurgeService)
    cacheDeviceService = app.get(AppTechCacheDeviceService)
    cacheService = app.get(AppTechCacheService)
    cookieSecret = app.get(ConfigService).get<string>('app.cookie.secret')!
    guardedPath = apiPath(app.get(ConfigService), SystemEndpointRoutes.USER_LOCK_READ)

    // 与 pg.purge.int-spec 同款：集成测试与本地 dev 共用 Redis，残留的 CRON_LOCK 会让
    // runExclusive 直接跳过、返回值变成 null（那是「没跑」而不是「删了 0 行」）
    await cacheService.del(CRON_LOCK_KEY)
  })

  afterAll(async () => {
    await cacheService?.del(CRON_LOCK_KEY)

    for (const deviceId of seededDeviceIds) {
      // 本文件自己种下的两把键：设备缓存（no TTL）+ 滑动续期闸（TTL = 有效期的 80%）
      await cacheDeviceService?.delSysDeviceCache(deviceId)
      await cacheService?.del(`${WalnutAdminConstAppCacheKeys.SYS_DEVICE_COOKIE_RENEW}:${deviceId}`)
    }

    if (seededDeviceIds.length > 0) {
      await pgDataSource.query('DELETE FROM app_monitor_user WHERE device_id = ANY($1::text[])', [seededDeviceIds])
      await pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [seededDeviceIds])
    }

    await app?.close()
  })

  it('purge 删行的同时失效 SYSTEM:DEVICE:<id>：不手工清缓存，同一枚 cookie 也变 40605', async () => {
    const deviceId = await seedExpiredDevice()

    // A 对照：行还在 ⇒ device guard 通过（缓存 miss 回源 DB 并回填），拒绝发生在更后面的层
    const alive = await requestWithDevice(deviceId)
    expect(bodyOf(alive).code).not.toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)

    // 关键前置：缓存里**确实**已经有了一条「放行凭据」—— 这就是本 bug 的载体。
    // 若这一步是 null，下面的 40605 就只是「本来就没缓存」，用例会空转。
    expect(await cacheDeviceService.getSysDeviceCache(deviceId)).not.toBeNull()

    expect(await purgeService.purgeInactiveDevices()).toBe(1)

    expect(await exists('sys_device', deviceId)).toBe(false)

    // B：**不手工清缓存**，同一枚 cookie 直接 40605（device.guard.ts:115-121 那条腿）。
    // 这是行为判据：缓存键没被失效时，guard 读到的仍是「放行」，请求会落到更后面几层，
    // 拿到的就不是 40605 —— 90 天留存策略在缓存层等于没生效。
    const gone = await requestWithDevice(deviceId)
    expect(bodyOf(gone).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)

    // 机制判据（与上一条互为因果）：删除设备行的同一任务里把缓存键一起清掉
    // （改前无任何生产代码调用 delSysDeviceCache）；键还在的话，40605 就可能只是「这一轮恰好 miss」
    expect(await cacheDeviceService.getSysDeviceCache(deviceId)).toBeNull()

    // 回源失败不留半截状态：没有反向「补建」设备行
    expect(await exists('sys_device', deviceId)).toBe(false)
  })

  it('缓存失效失败：DB 删除不回滚、任务不抛，且 error 日志带 deviceId 与失败计数（不静默）', async () => {
    const deviceId = await seedExpiredDevice()

    const alive = await requestWithDevice(deviceId)
    expect(bodyOf(alive).code).not.toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)
    expect(await cacheDeviceService.getSysDeviceCache(deviceId)).not.toBeNull()

    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const delSpy = vi.spyOn(cacheDeviceService, 'delSysDeviceCache')
      .mockRejectedValueOnce(new Error('redis down (simulated)'))

    try {
      // 删除本身照常成功：返回值是「删了几行」这个事实，不被缓存层改写成异常
      expect(await purgeService.purgeInactiveDevices()).toBe(1)

      // DB 删除**没有**被缓存失效失败回滚
      expect(await exists('sys_device', deviceId)).toBe(false)

      // 失败有痕迹：逐键 error（带 deviceId）+ 聚合 error（带 1/1 计数）
      const messages = errorSpy.mock.calls.map(call => String(call[0]))
      expect(messages.some(m => m.includes('[PgPurgeCacheInvalidationError]') && m.includes(deviceId))).toBe(true)
      expect(messages.some(m => m.includes('[PgPurgeCacheInvalidation]') && m.includes('1/1'))).toBe(true)

      // 现状记录：失效失败的键还在 ⇒ 该设备仍会被放行 —— 这正是「不能静默」要暴露的后果
      expect(await cacheDeviceService.getSysDeviceCache(deviceId)).not.toBeNull()
    }
    finally {
      delSpy.mockRestore()
      errorSpy.mockRestore()
      // 清理本用例故意留下的那把键（用例体里**没有**用它来让断言通过）
      await cacheDeviceService.delSysDeviceCache(deviceId)
    }
  })
})

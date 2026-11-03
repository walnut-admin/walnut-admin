import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'

import { SchedulerRegistry } from '@nestjs/schedule'
import { AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCronTaskNames } from '@walnut-server/const/app/task'
import { generateDeviceId, SysDevicePgPurgeService } from '@walnut-server/system'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgAdminDataSource, getWalnutPgDataSource } from './helpers/create-integration-app'

/**
 * 90 天设备留存清理（批次 11 · B5 收尾，on real PG）。
 *
 * 判据（device.repo.service.purgeInactiveDevicesBefore）：
 *   active = false AND updated_at < now()-90d AND NOT banned AND NOT locked
 *   AND 没有 90 天内的在线访客行 AND 没有未撤销且未过期的 RT
 *
 * 本文件钉住的四件事：
 * 1. 该删的删、**不该删的一个都不动**（banned / locked / active / 新鲜 / 有活心跳 / 有活 RT）；
 * 2. **连带删 monitor 行**（同一事务）—— app_monitor_user 没有 FK、visitor_id 全局唯一，
 *    留成孤儿会让同指纹的下一次首行登记撞 uq_monitor_visitor（23505 → 40000）；
 * 3. FK CASCADE 语义：设备行一删，sys_user_device 绑定与 auth_refresh_token 会话一起走；
 * 4. **RLS 负对照**：app_monitor_user 在 RLS 表清单里，非 system 通道的 DELETE 静默 0 行，
 *    而 cron 的 system 事务真的删得掉 —— 「返回 0 行」与「没删」必须可区分。
 */
const CRON_LOCK_KEY = 'CRON_LOCK:purgeInactiveDevices'

interface ISeedDeviceOptions {
  active?: boolean
  banned?: boolean
  locked?: boolean
  /** 距离现在的天数（写进 updated_at / created_at） */
  daysAgo?: number
}

describe('SysDevicePgPurgeService：90 天留存清理（on real PG）', () => {
  let app: INestApplication
  /** 管理通道（DATABASE_PG_USER / BYPASSRLS）：fixture 与断言用 */
  let pgDataSource: DataSource
  /** 运行时连接（walnut_app）：RLS 负对照用 */
  let appDataSource: DataSource
  let purgeService: SysDevicePgPurgeService
  let cacheService: AppTechCacheService

  const seed8 = randomUUID().slice(0, 8)
  let userId = ''
  /** 本文件播种过的设备（afterAll 全部清掉，避免污染 pg.purge.int-spec 的精确行数断言） */
  const seededDeviceIds: string[] = []

  async function seedDevice(options: ISeedDeviceOptions = {}) {
    const deviceId = generateDeviceId()
    const days = options.daysAgo ?? 0

    await pgDataSource.query(
      `INSERT INTO sys_device
         (device_name, device_id, device_info, ip_history, active, banned, locked, created_at, updated_at)
       VALUES ($1, $2, '{}'::jsonb, ARRAY[]::text[], $3, $4, $5,
               now() - ($6::int * interval '1 day'), now() - ($6::int * interval '1 day'))`,
      [`purge11-${seed8}-${randomUUID().slice(0, 8)}`, deviceId, options.active ?? false, options.banned ?? false, options.locked ?? false, days],
    )

    seededDeviceIds.push(deviceId)
    return deviceId
  }

  /**
   * 播一行在线访客。
   *
   * `userId` 只在 RLS 负对照里给：`app_monitor_user` 的 RESTRICTIVE 策略是
   * 「allow_all() OR user_id = 当前用户 OR user_id IS NULL」，匿名访客行（user_id 为 NULL）
   * 在 anonymous 模式下**也可见** —— 那正是应用层 allowAnonymous 的语义，会让「非 system 通道
   * 删不掉」这条断言变成空转。绑一个用户之后，anonymous 模式才真的看不见这一行。
   */
  async function seedMonitorRow(deviceId: string, options: { visitorId?: string, auth?: boolean, lastActiveDaysAgo?: number, userId?: string } = {}) {
    const visitorId = options.visitorId ?? `purge11-vis-${seed8}-${randomUUID().slice(0, 8)}`
    await pgDataSource.query(
      `INSERT INTO app_monitor_user (visitor_id, user_id, device_id, auth, is_left, first_visit_at, last_active_at)
       VALUES ($1, $2, $3, $4, false, now() - ($5::int * interval '1 day'), now() - ($5::int * interval '1 day'))`,
      [visitorId, options.userId ?? null, deviceId, options.auth ?? false, options.lastActiveDaysAgo ?? 0],
    )
    return visitorId
  }

  async function exists(table: string, deviceId: string) {
    const rows: Array<{ c: number }> = await pgDataSource.query(
      `SELECT count(*)::int AS c FROM ${table} WHERE device_id = $1`,
      [deviceId],
    )
    return rows[0].c > 0
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgAdminDataSource(app)
    appDataSource = getWalnutPgDataSource(app)
    purgeService = app.get(SysDevicePgPurgeService)
    cacheService = app.get(AppTechCacheService)

    // 与 pg.purge.int-spec 同款：集成测试与本地 dev 共用 Redis，残留的 CRON_LOCK 会让
    // runExclusive 直接跳过、返回值变成 null（那是「没跑」而不是「删了 0 行」）
    await cacheService.del(CRON_LOCK_KEY)

    const userRows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [`purge11-user-${seed8}`],
    )
    userId = userRows[0].id
  })

  afterAll(async () => {
    await cacheService?.del(CRON_LOCK_KEY)

    if (seededDeviceIds.length > 0) {
      // 设备行删除会 CASCADE 掉 user_device / RT；monitor 行没有 FK，单独清
      await pgDataSource.query('DELETE FROM app_monitor_user WHERE device_id = ANY($1::text[])', [seededDeviceIds])
      await pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [seededDeviceIds])
    }
    await pgDataSource.query('DELETE FROM app_monitor_user WHERE visitor_id LIKE $1', [`purge11-vis-${seed8}%`])
    await pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [userId])

    await app.close()
  })

  it('job 注册：@Cron 任务已挂到 ScheduleModule（每天 03:00）', () => {
    const schedulerRegistry = app.get(SchedulerRegistry)
    expect(schedulerRegistry.doesExist('cron', WalnutAdminConstAppCronTaskNames.SYS_DEVICE_RETENTION_PURGE)).toBe(true)
  })

  it('purgeInactiveDevices：过期行被清，未过期 / banned / locked / active / 有活心跳 / 有活 RT 的一个都不动', async () => {
    // ① 该删：90 天无活动的沉默设备
    const expired = await seedDevice({ daysAgo: 91 })
    // ② 不该删：封禁 / 锁定 / 在用 / 新鲜
    const banned = await seedDevice({ daysAgo: 91, banned: true })
    const locked = await seedDevice({ daysAgo: 91, locked: true })
    const active = await seedDevice({ daysAgo: 91, active: true })
    const fresh = await seedDevice({ daysAgo: 0 })
    // ③ 不该删：90 天内有心跳（心跳是比 updated_at 更细的活动证据）
    const heartbeat = await seedDevice({ daysAgo: 91 })
    await seedMonitorRow(heartbeat, { lastActiveDaysAgo: 1 })
    // ④ 不该删：还有未撤销且未过期的 RT（fk_rt_device 是 CASCADE，删设备 = 静默踢人）
    const sessioned = await seedDevice({ daysAgo: 91 })
    await pgDataSource.query(
      'INSERT INTO auth_refresh_token (jti, user_id, device_id, encrypted_token, expired_at) VALUES ($1, $2, $3, $4, $5)',
      [`purge11-rt-live-${seed8}`, userId, sessioned, 'enc', new Date(Date.now() + 24 * 3600_000).toISOString()],
    )
    // ⑤ 该删：过期设备 + 100 天前的旧访客行（「用过之后放弃」的主群 —— stale 恒 false 那群）
    const abandoned = await seedDevice({ daysAgo: 91 })
    const abandonedVisitorId = await seedMonitorRow(abandoned, { lastActiveDaysAgo: 100 })

    const purged = await purgeService.purgeInactiveDevices()

    // 恰好两行：expired + abandoned（其余全部命中排除条款）
    expect(purged).toBe(2)

    expect(await exists('sys_device', expired)).toBe(false)
    expect(await exists('sys_device', abandoned)).toBe(false)

    expect(await exists('sys_device', banned)).toBe(true)
    expect(await exists('sys_device', locked)).toBe(true)
    expect(await exists('sys_device', active)).toBe(true)
    expect(await exists('sys_device', fresh)).toBe(true)
    expect(await exists('sys_device', heartbeat)).toBe(true)
    expect(await exists('sys_device', sessioned)).toBe(true)

    // 连带删 monitor 行：abandoned 那台设备的旧访客行必须一起没（否则同指纹回访撞 23505）
    expect(await exists('app_monitor_user', abandoned)).toBe(false)
    // 有活心跳的那台设备，monitor 行当然还在
    expect(await exists('app_monitor_user', heartbeat)).toBe(true)

    // 同一 visitor_id 现在可以重新登记（uq_monitor_visitor 没有被孤儿钉死）
    const reborn = await seedDevice({ daysAgo: 0 })
    await expect(seedMonitorRow(reborn, { visitorId: abandonedVisitorId })).resolves.toBe(abandonedVisitorId)
  })

  it('幂等：第二次跑返回 0（全部谓词都是时间/状态判据，重复执行天然无目标）', async () => {
    expect(await purgeService.purgeInactiveDevices()).toBe(0)
  })

  it('FK CASCADE：设备行删除连带清 sys_user_device 绑定与已过期 RT 行', async () => {
    const target = await seedDevice({ daysAgo: 91 })
    await pgDataSource.query(
      'INSERT INTO sys_user_device (user_id, device_id, device_name, locked) VALUES ($1, $2, $3, false)',
      [userId, target, `purge11-ud-${seed8}`],
    )
    await pgDataSource.query(
      'INSERT INTO auth_refresh_token (jti, user_id, device_id, encrypted_token, expired_at, revoked) VALUES ($1, $2, $3, $4, $5, true)',
      [`purge11-rt-old-${seed8}`, userId, target, 'enc', new Date(Date.now() - 3600_000).toISOString()],
    )

    expect(await purgeService.purgeInactiveDevices()).toBe(1)

    expect(await exists('sys_device', target)).toBe(false)
    expect(await exists('sys_user_device', target)).toBe(false)
    expect(await exists('auth_refresh_token', target)).toBe(false)
  })

  it('RLS 负对照：非 system 通道删 monitor 行 ⇒ 0 行；cron 的 system 事务 ⇒ 真的删掉', async () => {
    const target = await seedDevice({ daysAgo: 91 })
    // 绑用户：匿名访客行（user_id IS NULL）在 anonymous 模式下也可见，负对照会空转
    await seedMonitorRow(target, { lastActiveDaysAgo: 100, userId })

    // 运行时连接（walnut_app）没有 set_config system ⇒ 策略把 DELETE 过滤成 0 行。
    // RETURNING 让「一行都没动」可观测 —— 否则 affected=0 与「语句没跑」不可区分。
    // 注意返回形状：Postgres 驱动对非 SELECT 语句返回 `[rows, rowCount]` 二元组（实测
    // 0 行时是 `[[], 0]`），行数组在第一项 —— 这条在 purgeInactiveDevicesBefore 里踩过。
    const appChannelRaw = await appDataSource.query<Array<{ id: string }>>(
      'DELETE FROM app_monitor_user WHERE device_id = $1 RETURNING id',
      [target],
    )
    const appChannelDeleted = (Array.isArray(appChannelRaw[0]) ? appChannelRaw[0] : appChannelRaw) as Array<{ id: string }>
    expect(appChannelDeleted).toHaveLength(0)
    expect(await exists('app_monitor_user', target)).toBe(true)

    // cron 走 runInWalnutSystemTransaction ⇒ 同一行删得掉（正面证明上一段不是「本来就空」）
    expect(await purgeService.purgeInactiveDevices()).toBe(1)
    expect(await exists('app_monitor_user', target)).toBe(false)
    expect(await exists('sys_device', target)).toBe(false)
  })
})

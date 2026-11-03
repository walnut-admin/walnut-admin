import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { createHash, randomUUID } from 'node:crypto'

import { SchedulerRegistry } from '@nestjs/schedule'
import { AuthRefreshTokenPgPurgeService } from '@walnut-server/auth'
import { AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCronTaskNames } from '@walnut-server/const/app/task'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgAdminDataSource } from './helpers/create-integration-app'

/**
 * PG 版过期 refresh token purge job（phase2 第 6 节 Q10-b）：
 * - job 注册：@Cron(EVERY_HOUR) 已挂到 ScheduleModule（SchedulerRegistry 可查）；
 * - SQL 语义：只删 `expired_at < now()` 的行，未过期行（含未撤销的活跃令牌）不动。
 *
 * 直接调 `purgeExpiredRefreshTokens()`（定时触发与手动触发走同一方法体）；
 * FK 依赖的 sys_user / sys_device 用 raw SQL 播种最小行。
 */
/**
 * 设备业务键：必须是服务端签发的形态（d1_ + 32 位小写 hex）—— migration 的
 * ck_device_device_id_form 会拦旧形态（64 位 hex / 任意可读标签）。
 *
 * 标签到 id 的映射是确定性的：插入与断言用同一标签即得同一个 id，无需在两个地方各写一遍
 * 字面量。
 */
function devId(label: string) {
  const digest = createHash('sha256').update(label).digest('hex').slice(0, 32)
  return `d1_${digest}`
}

describe('AuthRefreshTokenPgPurgeService (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let purgeService: AuthRefreshTokenPgPurgeService
  let cacheService: AppTechCacheService

  const seed = randomUUID()

  // 本 spec 直接调用 @Cron 方法（W2-A 起走 Redis try-lock）；集成测试与本地 dev 共用 Redis，
  // 残留的 CRON_LOCK 会让 runExclusive 直接跳过、purged 变成 null。
  const CRON_LOCK_KEY = 'CRON_LOCK:purgeExpiredRefreshTokens'

  let userId = ''
  // FK 挂在业务键 sys_device(device_id)（Q5 定案），不是 uuid PK
  let deviceBusinessKey = ''

  // F-26 起「未撤销现役行恒恰一行」由部分唯一索引 uq_rt_active_device_user 兜住：同
  // (user, device) 只能有一条 revoked=false。本 spec 要在同一台设备上播两行过期行，
  // 按真实形态把过期行标成已撤销（轮换/清理后的历史行）—— purge 只按 expired_at 删，
  // 与撤销状态无关，用例判据不变。
  async function insertRefreshToken(jti: string, expiredAt: string, revoked = false) {
    await pgDataSource.query(
      'INSERT INTO auth_refresh_token (jti, user_id, device_id, encrypted_token, expired_at, revoked) VALUES ($1, $2, $3, $4, $5, $6)',
      [jti, userId, deviceBusinessKey, `enc-${jti}`, expiredAt, revoked],
    )
  }

  async function countTokens(jti: string) {
    const rows: Array<{ count: number }> = await pgDataSource.query(
      'SELECT count(*)::int AS count FROM auth_refresh_token WHERE jti = $1',
      [jti],
    )
    return rows[0].count
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgAdminDataSource(app)
    purgeService = app.get(AuthRefreshTokenPgPurgeService)
    cacheService = app.get(AppTechCacheService)

    // 起跑前清掉残留锁（共享 dev Redis 可能留着上一次运行 / 本地 dev 进程的键），
    // 否则本 spec 的 purge 调用会被当成「另一实例在跑」而跳过
    await cacheService.del(CRON_LOCK_KEY)

    // FK 依赖：auth_refresh_token.user_id → sys_user、device_id → sys_device(device_id)
    deviceBusinessKey = devId(`purge-spec-${seed}`)
    await pgDataSource.query(
      'INSERT INTO sys_device (device_name, device_id, device_info, ip_history) VALUES ($1, $2, $3::jsonb, ARRAY[]::text[])',
      [`purge-spec-device-${seed}`, deviceBusinessKey, '{}'],
    )

    const userRows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [`purge-spec-user-${seed}`],
    )
    userId = userRows[0].id
  })

  afterAll(async () => {
    // 测试自己持过的锁由 runExclusive 释放；这里兜底清掉异常中断可能的残留
    await cacheService?.del(CRON_LOCK_KEY)
    await app.close()
  })

  it('job 注册：@Cron 任务已挂到 ScheduleModule', () => {
    const schedulerRegistry = app.get(SchedulerRegistry)

    expect(schedulerRegistry.doesExist('cron', WalnutAdminConstAppCronTaskNames.AUTH_DELETE_REFRESH_PG_PURGE)).toBe(true)
  })

  it('purgeExpiredRefreshTokens：只删过期行，未过期（活跃）行保留', async () => {
    const expiredAgo2h = `purge-expired-2h-${seed}`
    const expiredAgo1min = `purge-expired-1m-${seed}`
    const liveIn7d = `purge-live-${seed}`

    await insertRefreshToken(expiredAgo2h, new Date(Date.now() - 2 * 3600_000).toISOString(), true)
    await insertRefreshToken(expiredAgo1min, new Date(Date.now() - 60_000).toISOString(), true)
    await insertRefreshToken(liveIn7d, new Date(Date.now() + 7 * 24 * 3600_000).toISOString())

    const purged = await purgeService.purgeExpiredRefreshTokens()

    // 集成库只有本轮播种的数据（globalSetup drop 后重建），过期行恰好 2 条
    expect(purged).toBe(2)
    expect(await countTokens(expiredAgo2h)).toBe(0)
    expect(await countTokens(expiredAgo1min)).toBe(0)
    expect(await countTokens(liveIn7d)).toBe(1)
  })
})

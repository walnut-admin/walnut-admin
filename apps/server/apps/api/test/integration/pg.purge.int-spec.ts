import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'

import { SchedulerRegistry } from '@nestjs/schedule'
import { WalnutAdminConstAppCronTaskNames } from '@walnut-server/const/app/task'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AuthRefreshTokenPgPurgeService } from '@/modules/auth/modules/refresh/repo/refresh.pg.purge.service'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'

/**
 * PG 版过期 refresh token purge job（phase2 第 6 节 Q10-b）：
 * - job 注册：@Cron(EVERY_HOUR) 已挂到 ScheduleModule（SchedulerRegistry 可查）；
 * - SQL 语义：只删 `expired_at < now()` 的行，未过期行（含未撤销的活跃令牌）不动。
 *
 * 直接调 `purgeExpiredRefreshTokens()`（定时触发与手动触发走同一方法体）；
 * FK 依赖的 sys_user / sys_device 用 raw SQL 播种最小行。
 */
describe('AuthRefreshTokenPgPurgeService (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let purgeService: AuthRefreshTokenPgPurgeService

  const seed = randomUUID()

  let userId = ''
  // FK 挂在业务键 sys_device(device_id)（Q5 定案），不是 uuid PK
  let deviceBusinessKey = ''

  async function insertRefreshToken(jti: string, expiredAt: string) {
    await pgDataSource.query(
      'INSERT INTO auth_refresh_token (jti, user_id, device_id, encrypted_token, expired_at) VALUES ($1, $2, $3, $4, $5)',
      [jti, userId, deviceBusinessKey, `enc-${jti}`, expiredAt],
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
    pgDataSource = getWalnutPgDataSource(app)
    purgeService = app.get(AuthRefreshTokenPgPurgeService)

    // FK 依赖：auth_refresh_token.user_id → sys_user、device_id → sys_device(device_id)
    deviceBusinessKey = `purge-spec-${seed}`
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

    await insertRefreshToken(expiredAgo2h, new Date(Date.now() - 2 * 3600_000).toISOString())
    await insertRefreshToken(expiredAgo1min, new Date(Date.now() - 60_000).toISOString())
    await insertRefreshToken(liveIn7d, new Date(Date.now() + 7 * 24 * 3600_000).toISOString())

    const purged = await purgeService.purgeExpiredRefreshTokens()

    // 集成库只有本轮播种的数据（globalSetup drop 后重建），过期行恰好 2 条
    expect(purged).toBe(2)
    expect(await countTokens(expiredAgo2h)).toBe(0)
    expect(await countTokens(expiredAgo1min)).toBe(0)
    expect(await countTokens(liveIn7d)).toBe(1)
  })
})

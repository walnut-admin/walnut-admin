import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'

import { WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { WalnutAdminExceptionRefreshTokenExpired } from '@walnut-server/exceptions/business/auth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AuthRefreshRepositoryService } from '@/modules/auth/modules/refresh/repo/refresh.repo.service'
import { AuthRefreshSharedService } from '@/modules/auth/modules/refresh/shared/refresh.shared.service'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'

/**
 * B7b auth_refresh_token 用例（phase2 4.24 / phase3-plan §1 B7b，on real PG）：
 * - 索引对齐：uq_jti / idx_rt_user / idx_rt_device / idx_rt_expired（purge 判据列）；
 * - refresh 轮换**事务原子性**（B7b 全 PG 单 em）：getNewAccessToken 的过期兜底腿
 *   （revoke）与轮换腿（rotate）在同一 PG 事务里 —— 过期行路径整体回滚后行原样、
 *   提交路径两腿同落；
 * - **revoke-and-insert 轮换**（2026-10-27，取代 P0-1 的入口密文快照比对）：轮换 =
 *   旧行置 `revoked=true (reason=rotate)` + INSERT 新行（新 jti / 新密文 / 新过期时间）
 *   —— 旧行 jti 一切后续 getNewAccessToken（顺序重放）受控 40102；行级撤销让「恰
 *   1 路成功」在并发下确定性成立（并发面由 concurrency.api-spec G1 五路并发钉）；
 * - generateRefreshToken：新设备插入（PK 走 DB 端 uuidv7()）、同设备未撤销再签 →
 *   DuplicateSignIn；
 * - device_id 业务键 FK → sys_device(device_id) CASCADE（Q5 定案：设备删则令牌清）。
 *
 * 注意：本 spec 不调用全局 purge（pg.purge.int-spec 对集成库做过期行计数断言），
 * 过期行在本文件 afterAll 随 user CASCADE 清场。
 */
describe('B7b auth_refresh_token (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource

  let refreshRepo: AuthRefreshRepositoryService
  let refreshShared: AuthRefreshSharedService
  let tokenService: AppTokenService

  const seed = randomUUID()
  const unique = (prefix: string) => `${prefix}-${seed.slice(0, 8)}`

  let userId = ''

  async function insertToken(jti: string, deviceId: string, expiredAt: Date, encryptedToken = `enc-${jti}`) {
    await pgDataSource.query(
      'INSERT INTO auth_refresh_token (jti, user_id, device_id, encrypted_token, expired_at) VALUES ($1, $2, $3, $4, $5)',
      [jti, userId, deviceId, encryptedToken, expiredAt.toISOString()],
    )
  }

  async function readToken(jti: string): Promise<{ revoked: boolean, revoke_reason: string | null, encrypted_token: string, expired_at: Date }> {
    const rows: Array<{ revoked: boolean, revoke_reason: string | null, encrypted_token: string, expired_at: Date }> = await pgDataSource.query(
      'SELECT revoked, revoke_reason, encrypted_token, expired_at FROM auth_refresh_token WHERE jti = $1',
      [jti],
    )
    return rows[0]
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)

    refreshRepo = app.get(AuthRefreshRepositoryService)
    refreshShared = app.get(AuthRefreshSharedService)
    tokenService = app.get(AppTokenService)

    const userRows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [unique('b7-rt-user')],
    )
    userId = userRows[0].id

    // refresh.device_id 是业务键 FK → sys_device(device_id)；每台设备一行 ——
    // revoke 腿按 (user_id, device_id) findOne，同设备多行会互相污染断言
    for (const key of ['device-key', 'device-live', 'device-rb', 'device-rb2', 'device-commit', 'device-replay']) {
      await pgDataSource.query(
        'INSERT INTO sys_device (device_name, device_id, device_info, ip_history) VALUES ($1, $2, $3::jsonb, ARRAY[]::text[])',
        [unique(`b7-rt-${key}`), `b7-rt-${key}`, '{}'],
      )
    }

    // checkUserAndRoleStatus 要求用户至少有一个角色（零角色视为被封禁）
    const roleRows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_role (role_name) VALUES ($1) RETURNING id',
      [unique('b7-rt-role')],
    )
    await pgDataSource.query(
      'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2)',
      [userId, roleRows[0].id],
    )
  })

  afterAll(async () => {
    // refresh 行随 user/device CASCADE 清场（含过期行，不污染 pg.purge.int-spec 的计数断言）
    await pgDataSource.query('DELETE FROM sys_user WHERE user_name LIKE $1', [`${unique('b7-rt-user')}%`])
    await pgDataSource.query('DELETE FROM sys_device WHERE device_name LIKE $1', [`${unique('b7-rt-device')}%`])
    await app.close()
  })

  it('索引对齐：uq_jti / idx_rt_user / idx_rt_device / idx_rt_expired', async () => {
    const rows: Array<{ indexname: string }> = await pgDataSource.query(
      'SELECT indexname FROM pg_indexes WHERE tablename = $1',
      ['auth_refresh_token'],
    )
    const names = rows.map(r => r.indexname)

    expect(names).toContain('uq_jti')
    expect(names).toContain('idx_rt_user')
    expect(names).toContain('idx_rt_device')
    expect(names).toContain('idx_rt_expired')
  })

  it('getNewAccessToken 活跃行：revoke-and-insert 轮换（旧行 revoked=rotate + 新行未撤销）并签出新 AT', async () => {
    const jti = unique('b7-rt-live')
    const oldExpiredAt = new Date(Date.now() + 3600_000)
    await insertToken(jti, 'b7-rt-device-live', oldExpiredAt)

    // 生产路径在 @WalnutDBTransaction 内轮换——这里也用真实事务，
    // 让轮换读腿的悲观写锁（串行化「读校验+撤销+插入」）真正被走到
    const { accessToken: newAT, jti: newJti } = await pgDataSource.transaction(async em =>
      refreshShared.getNewAccessToken(jti, 'b7-rt-device-live', 'session-1', em))

    // 新 jti 与旧行不同（行级撤销后 cookie 必须换新）
    expect(newJti).toBeTruthy()
    expect(newJti).not.toBe(jti)

    // AT 可解码且带同一 sid / userId
    const payload = await tokenService.decodeAccessToken(newAT)
    expect(payload?.sid).toBe('session-1')
    expect(payload?.userId).toBe(userId)

    // 旧行：已撤销（reason=rotate），密文/过期时间原样（revoke-and-insert 不改旧行其余列）
    const oldRow = await readToken(jti)
    expect(oldRow.revoked).toBe(true)
    expect(oldRow.revoke_reason).toBe(WalnutAdminConstRevokeRTType.rotate)
    expect(oldRow.encrypted_token).toBe(`enc-${jti}`)

    // 新行：未撤销、密文是新签 RT 的密文、过期时间延长
    const newRowRows: Array<{ jti: string, revoked: boolean, encrypted_token: string, expired_at: Date, user_id: string, device_id: string }>
      = await pgDataSource.query(
        'SELECT jti, revoked, encrypted_token, expired_at, user_id, device_id FROM auth_refresh_token WHERE jti = $1',
        [newJti],
      )
    expect(newRowRows).toHaveLength(1)
    const newRow = newRowRows[0]
    expect(newRow.revoked).toBe(false)
    expect(newRow.encrypted_token).not.toBe(`enc-${jti}`)
    expect(newRow.expired_at.getTime()).toBeGreaterThan(oldExpiredAt.getTime())
    // 新行同 user / device（会话延续，只有令牌换轮）
    expect(newRow.user_id).toBe(userId)
    expect(newRow.device_id).toBe('b7-rt-device-live')
  })

  it('revoke-and-insert 顺序重放：轮换成功后旧行 jti 再 getNewAccessToken → 40102（行级撤销拦截）', async () => {
    // HTTP 层等价面：客户端 cookie 里的 jti 在轮换后被换新，旧 jti 重放等价于
    // 「持已撤销行再换」—— service 层直测旧行 jti 的后续轮换即死
    const jti = unique('b7-rt-replay')
    await insertToken(jti, 'b7-rt-device-replay', new Date(Date.now() + 3600_000))

    // 第一次轮换：旧行撤销 + 新行插入
    const { jti: newJti } = await pgDataSource.transaction(async em =>
      refreshShared.getNewAccessToken(jti, 'b7-rt-device-replay', 'session-replay', em))
    expect(newJti).not.toBe(jti)

    const oldRow = await readToken(jti)
    expect(oldRow.revoked).toBe(true)

    // 旧行 jti 再轮换（顺序重放）→ 锁内读到撤销行 → 受控 40102
    await expect(pgDataSource.transaction(async em =>
      refreshShared.getNewAccessToken(jti, 'b7-rt-device-replay', 'session-replay', em)))
      .rejects
      .toThrow(WalnutAdminExceptionRefreshTokenExpired)

    // 重放无副作用：旧行保持撤销、新行未被波及（无第三次插入）
    const rows: Array<{ c: number }> = await pgDataSource.query(
      'SELECT count(*)::int AS c FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
      [userId, 'b7-rt-device-replay'],
    )
    expect(rows[0].c).toBe(2)

    // 现役行（新 jti）合法续期不受影响：再轮换一次成功、产生第三个 jti
    const second = await pgDataSource.transaction(async em =>
      refreshShared.getNewAccessToken(newJti, 'b7-rt-device-replay', 'session-replay', em))
    expect(second.jti).not.toBe(newJti)
  })

  it('过期行：getNewAccessToken 的 revoke 兜底腿 + rotate 在同一事务里可整体回滚', async () => {
    const jti = unique('b7-rt-expired')
    await insertToken(jti, 'b7-rt-device-rb', new Date(Date.now() - 3600_000))

    // 同事务里先撤第二台设备的行（revoke 腿），再走过期行的 revoke+throw 路径 ——
    // 抛错令事务回滚，两腿都不落库（过期判定先于轮换腿，无新行插入）
    const jtiOther = unique('b7-rt-other')
    await insertToken(jtiOther, 'b7-rt-device-rb2', new Date(Date.now() + 3600_000))

    await expect(pgDataSource.transaction(async (em) => {
      await refreshShared.revokeRTForUserDevice(userId, 'b7-rt-device-rb2', em)

      await expect(refreshShared.getNewAccessToken(jti, 'b7-rt-device-rb', 'session-2', em))
        .rejects
        .toThrow(WalnutAdminExceptionRefreshTokenExpired)

      // 到这里说明两腿都执行过 —— 主动抛出触发整体回滚
      throw new Error('force-rollback')
    })).rejects.toThrow('force-rollback')

    // 过期行原样：未撤销、密文未轮换、无新行（轮换腿未执行）
    const expiredRow = await readToken(jti)
    expect(expiredRow.revoked).toBe(false)
    expect(expiredRow.encrypted_token).toBe(`enc-${jti}`)
    const rows: Array<{ c: number }> = await pgDataSource.query(
      'SELECT count(*)::int AS c FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
      [userId, 'b7-rt-device-rb'],
    )
    expect(rows[0].c).toBe(1)

    // revoke 腿同样被回滚
    const otherRow = await readToken(jtiOther)
    expect(otherRow.revoked).toBe(false)
  })

  it('过期行路径提交：revoke 兜底落库（revoke + throw 同事务提交后行被撤销）', async () => {
    const jti = unique('b7-rt-expired-commit')
    await insertToken(jti, 'b7-rt-device-commit', new Date(Date.now() - 60_000))

    await expect(refreshShared.getNewAccessToken(jti, 'b7-rt-device-commit', 'session-3', pgDataSource.manager))
      .rejects
      .toThrow(WalnutAdminExceptionRefreshTokenExpired)

    const row = await readToken(jti)
    expect(row.revoked).toBe(true)
  })

  it('generateRefreshToken：新设备插入（PK uuidv7 由 DB 生成）；同设备未撤销再签 → DuplicateSignIn', async () => {
    const deviceId = 'b7-rt-device-key'
    const sessionId = 'session-gen'

    const jti = await refreshShared.generateRefreshToken(userId, deviceId, sessionId, pgDataSource.manager)
    expect(jti).toBeTruthy()

    const rows: Array<{ id: string, user_id: string, device_id: string, revoked: boolean }> = await pgDataSource.query(
      'SELECT id, user_id, device_id, revoked FROM auth_refresh_token WHERE jti = $1',
      [jti],
    )
    expect(rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(rows[0].user_id).toBe(userId)
    expect(rows[0].device_id).toBe(deviceId)
    expect(rows[0].revoked).toBe(false)

    await expect(refreshShared.generateRefreshToken(userId, deviceId, sessionId, pgDataSource.manager))
      .rejects
      .toThrow()
  })

  it('purge job 判据：findExpiredTokens 只取 expired_at < now 的行（idx_rt_expired 通道）', async () => {
    const expiredJti = unique('b7-rt-find-expired')
    const liveJti = unique('b7-rt-find-live')
    await insertToken(expiredJti, 'b7-rt-device-key', new Date(Date.now() - 5000))
    await insertToken(liveJti, 'b7-rt-device-key', new Date(Date.now() + 3600_000))

    const expired = await refreshRepo.findExpiredTokens(new Date())
    const jtis = expired.map(r => r.jti)

    expect(jtis).toContain(expiredJti)
    expect(jtis).not.toContain(liveJti)
  })

  it('device_id 业务键 FK CASCADE：删设备连带清令牌（Q5 定案语义）', async () => {
    const jti = unique('b7-rt-cascade')
    await insertToken(jti, 'b7-rt-device-key', new Date(Date.now() + 3600_000))
    expect((await readToken(jti)).encrypted_token).toBeTruthy()

    await pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', ['b7-rt-device-key'])
    expect(await refreshRepo.findByJti(jti)).toBeNull()
  })
})

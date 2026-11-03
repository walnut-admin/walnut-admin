import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { createHash, randomUUID } from 'node:crypto'

import { DBTransactionHooksStore } from '@walnut-server/db'
import { SysUserDeviceRepositoryService, SysUserLockRepositoryService, SysUserLockService, SysUserLockSharedService } from '@walnut-server/identity'
import { compare } from 'bcryptjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgAdminDataSource } from './helpers/create-integration-app'

/**
 * B7b user_lock 用例（phase2 4.11 / phase3-plan §1 B7b，on real PG）：
 * - 唯一写入路径 insertOrUpdateUserLockPre：ON CONFLICT (user_id) upsert ——
 *   首插缺省列落 DB 默认值（lock_cross_device=true / lock_mode='default'）、
 *   二写更新不新建（uq_user_lock_user 一用户一锁配置，Q2）；
 * - **密码 hash 写入路径**（原 schema pre('save') 钩子迁 repo）：带 lockPwdHash 的写入
 *   落库前 bcrypt 加盐 hash（compare 验证），不带的写入不动既有 hash；首插/更新两条
 *   路径全覆盖；
 * - service 读腿：无记录返默认偏好、有记录按 crossDevice 分支查 user_device 锁状态；
 * - shared lock：联动 user_device 置 locked（全 PG 单 em）；unlock 密码错误拒绝。
 */

/** 复刻 tx.interceptor 的 ALS 钩子通道：lock 主逻辑走 registerAfterCommitHook（strict 版） */
async function runInHookStore<T>(fn: () => Promise<T>): Promise<T> {
  const hooks: (() => Promise<void>)[] = []
  const result = await DBTransactionHooksStore.run(hooks, async () => fn())
  for (const hook of hooks) {
    await hook()
  }
  return result
}

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

describe('B7b user_lock (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource

  let lockRepo: SysUserLockRepositoryService
  let lockService: SysUserLockService
  let lockSharedService: SysUserLockSharedService
  let userDeviceRepo: SysUserDeviceRepositoryService

  async function seedUser(): Promise<string> {
    const rows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [`b7-lock-user-${randomUUID()}`],
    )
    return rows[0].id
  }

  async function countLocks(userId: string): Promise<number> {
    const rows: Array<{ c: number }> = await pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_lock WHERE user_id = $1',
      [userId],
    )
    return rows[0].c
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgAdminDataSource(app)

    lockRepo = app.get(SysUserLockRepositoryService)
    lockService = app.get(SysUserLockService)
    lockSharedService = app.get(SysUserLockSharedService)
    userDeviceRepo = app.get(SysUserDeviceRepositoryService)
  })

  afterAll(async () => {
    // lock / user_device 行随 user CASCADE
    await pgDataSource.query('DELETE FROM sys_user WHERE user_name LIKE $1', ['b7-lock-user-%'])
    await app.close()
  })

  describe('insertOrUpdateUserLockPre：upsert 与 hash 写入路径', () => {
    it('首插：缺省列落 DB 默认值，不带密码则 hash 列为空', async () => {
      const userId = await seedUser()

      const row = await lockRepo.insertOrUpdateUserLockPre(userId, { lockRoute: { name: 'dashboard' } })

      expect(row.userId).toBe(userId)
      expect(row.lockRoute).toEqual({ name: 'dashboard' })
      expect(row.lockPwdHash).toBeNull()
      // DB 默认值（对齐 Mongo schema 默认）
      expect(row.lockCrossDevice).toBe(true)
      expect(row.lockMode).toBe('default')
      expect(row.lockIdleSec).toBe(600)
      expect(row.lockSecuritySec).toBe(60)
      expect(await countLocks(userId)).toBe(1)
    })

    it('密码 hash 写入路径：落库前 bcrypt 加盐，密文可 compare 通过', async () => {
      const userId = await seedUser()

      const row = await lockRepo.insertOrUpdateUserLockPre(userId, { lockPwdHash: 'plain-pwd-1' })

      // 密文不是明文，且 bcrypt compare 通过
      expect(row.lockPwdHash).not.toBe('plain-pwd-1')
      expect(row.lockPwdHash).toMatch(/^\$2[aby]\$/)
      expect(await compare('plain-pwd-1', row.lockPwdHash!)).toBe(true)

      // 更新路径换密码：旧密码失效、新密码通过，仍只有一行
      const updated = await lockRepo.insertOrUpdateUserLockPre(userId, { lockPwdHash: 'plain-pwd-2' })
      expect(await countLocks(userId)).toBe(1)
      expect(await compare('plain-pwd-2', updated.lockPwdHash!)).toBe(true)
      expect(await compare('plain-pwd-1', updated.lockPwdHash!)).toBe(false)
    })

    it('不带密码的更新不动既有 hash；lockRoute 更新不新建', async () => {
      const userId = await seedUser()

      const first = await lockRepo.insertOrUpdateUserLockPre(userId, { lockPwdHash: 'keep-me' })
      const hashAfterFirst = first.lockPwdHash

      const second = await lockRepo.insertOrUpdateUserLockPre(userId, { lockRoute: { name: 'home' } })

      expect(await countLocks(userId)).toBe(1)
      expect(second.lockPwdHash).toBe(hashAfterFirst)
      expect(await compare('keep-me', second.lockPwdHash!)).toBe(true)
      expect(second.lockRoute).toEqual({ name: 'home' })
    })
  })

  describe('service 读腿与 shared lock 联动', () => {
    /** user_device.device_id 是业务键 FK → sys_device(device_id)，先注册设备行 */
    async function seedDevice(deviceId: string) {
      await pgDataSource.query(
        'INSERT INTO sys_device (device_name, device_id, device_info, ip_history) VALUES ($1, $2, $3::jsonb, ARRAY[]::text[])',
        [`b7-lock-dev-${deviceId}`, deviceId, '{}'],
      )
    }

    it('无记录 → 默认偏好；有记录 → 按 crossDevice 分支取 user_device 锁状态', async () => {
      const userId = await seedUser()
      await seedDevice(devId('device-x'))

      const empty = await lockService.getLockStatusForUser(userId, devId('device-x'))
      expect(empty.locked).toBe(false)
      expect(empty.lockCrossDevice).toBe(false)
      expect(empty.lockMode).toBe('default')

      await lockRepo.insertOrUpdateUserLockPre(userId, { lockRoute: { name: 'dashboard' } })

      // crossDevice=true 分支：any device locked（无设备行 → false）
      const status = await lockService.getLockStatusForUser(userId, devId('device-x'))
      expect(status.lockRoute).toEqual({ name: 'dashboard' })
      expect(status.lockCrossDevice).toBe(true)
      expect(status.locked).toBe(false)

      // 置一台设备 locked → any-locked 变 true
      await pgDataSource.query(
        'INSERT INTO sys_user_device (user_id, device_id, device_name, locked) VALUES ($1, $2, $3, true)',
        [userId, devId('device-x'), 'dev'],
      )
      const locked = await lockService.getLockStatusForUser(userId, devId('device-x'))
      expect(locked.locked).toBe(true)
    })

    it('shared lockUserDevice：lock preference upsert + user_device 置 locked（全 PG 单 em）', async () => {
      const userId = await seedUser()
      await seedDevice(devId('device-lock'))

      await pgDataSource.query(
        'INSERT INTO sys_user_device (user_id, device_id, device_name, locked) VALUES ($1, $2, $3, false)',
        [userId, devId('device-lock'), 'dev'],
      )

      await runInHookStore(async () => {
        await lockSharedService.lockUserDevice(userId, devId('device-lock'), 'fp-1', { name: 'dashboard' }, pgDataSource.manager)
      })

      const pref = await lockRepo.findUserLockPreByUserId(userId)
      expect(pref?.lockRoute).toEqual({ name: 'dashboard' })

      const device = await userDeviceRepo.findByUserAndDevice(userId, devId('device-lock'))
      expect(device?.locked).toBe(true)
    })

    it('shared unLockUserDevice：密码错误拒绝（BadRequest），不触碰设备状态', async () => {
      const userId = await seedUser()
      await seedDevice(devId('device-unlock'))

      await pgDataSource.query(
        'INSERT INTO sys_user_device (user_id, device_id, device_name, locked) VALUES ($1, $2, $3, true)',
        [userId, devId('device-unlock'), 'dev'],
      )
      await lockRepo.insertOrUpdateUserLockPre(userId, { lockPwdHash: 'right-pwd' })

      await expect(
        lockSharedService.unLockUserDevice(userId, devId('device-unlock'), 'fp-2', 'wrong-pwd', pgDataSource.manager),
      ).rejects.toThrow()

      const device = await userDeviceRepo.findByUserAndDevice(userId, devId('device-unlock'))
      expect(device?.locked).toBe(true)
    })
  })
})

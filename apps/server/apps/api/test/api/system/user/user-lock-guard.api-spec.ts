import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutAuthTokens } from '../../helpers/api-client'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { AppTechCacheLockService, AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'

/**
 * `SECURITY:LOCK` 缓存的 TTL 边界（`guard-matrix.api-spec.ts:876` 只测了显式 unlock 后恢复）。
 *
 * 先摆事实（读实现得出，别照任务书抄）：
 * - 服务端锁定状态的**真源是 DB**（`sys_user_device.locked`），缓存只是加速；
 *   `AppTechCacheLockService.setDeviceLockCache` 写的是 `{ t: BUILT_IN }`、**不传 ttl**
 *   ⇒ 缓存键本身永不过期（`cache.lock.ts:37-48`，本文件最后一条用例直接断言 `ttl === 0`）；
 * - `lockIdleSec` 是 `sys_user_lock` 里的**客户端偏好**（空闲锁屏秒数）。
 *   注意两套默认值：无偏好行时 service 兜底 300，行存在时 DB 默认 600（entity:37-38）。
 *   服务端**没有**任何「按 lockIdleSec 自动解锁」的定时/惰性逻辑。
 *
 * 所以「TTL 到期自动解锁」在本仓能观测到的唯一语义是：**缓存键到期 ⇒ 守卫回源 DB ⇒
 * 以 DB 为准**。本文件用真实 Redis 的 `expire`（同一个键、同一条 `AppTechCacheService`
 * 通道，与「如果它真有 TTL」完全同构）把这条语义钉死，并给出两个方向的边界：
 * - TTL 到期但 **DB 仍锁** ⇒ 仍 40118（缓存消失**不**等于解锁，fail-closed）；
 * - TTL 未到期但 DB 已解（模拟空闲到期/管理员直改库）⇒ 仍 40118（缓存赢）；
 *   TTL 到期后同一请求 ⇒ 20000（DB 赢），并回填 `false` 到缓存。
 *
 * 键空间：`checkIsLocked` 先读全局键 `...:<userId>:global`、再读设备键
 * `...:<userId>:<deviceId>`；写哪一个是 `sys_user_lock.lock_cross_device` 决定的
 * （DB 默认 **true** ⇒ 全局键）。本文件在 beforeAll 显式把偏好钉成单设备模式（false），
 * 让 1–7 条用例全部落在设备键上；第 8 条再翻成 true，单独钉全局键那条腿。
 */

/** TypeORM 对 UPDATE/DELETE ... RETURNING 返回 `[rows, affectedCount]`；SELECT 直接返回 rows */
function returnedRows<T>(raw: unknown): T[] {
  if (Array.isArray(raw) && raw.length === 2 && Array.isArray(raw[0]) && typeof raw[1] === 'number') {
    return raw[0] as T[]
  }
  return raw as T[]
}

describe('Lock guard：SECURITY_LOCK 缓存 TTL 到期 ⇒ 回源 DB（DB 已解锁则自动恢复放行）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  let tokens: WalnutAuthTokens | null = null

  /** 非 LockFree 的全链端点（lock/read/unlock/preference 是 LockFree 时锁不住） */
  const PROBE_PATH = '/system/user/me/profile'
  const PREFERENCE_PATH = '/system/user/lock/preference'

  function globalLockKey(): string {
    return `${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${fixture!.userId}:global`
  }

  function deviceLockKey(): string {
    return `${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${fixture!.userId}:${api.deviceId}`
  }

  async function dbLocked(): Promise<boolean> {
    const rows = returnedRows<{ locked: boolean }>(await api.pgDataSource.query(
      'SELECT locked FROM sys_user_device WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, api.deviceId],
    ))
    expect(rows).toHaveLength(1)
    return rows[0].locked
  }

  /** 直接改 DB 的锁定列（模拟「空闲到期 / 管理员直改库」—— 绕开 unlock 端点对缓存的同步写） */
  async function setDbLocked(locked: boolean): Promise<void> {
    const rows = returnedRows<{ locked: boolean }>(await api.pgDataSource.query(
      'UPDATE sys_user_device SET locked = $3 WHERE user_id = $1 AND device_id = $2 RETURNING locked',
      [fixture!.userId, api.deviceId, locked],
    ))
    expect(rows).toHaveLength(1)
    expect(rows[0].locked).toBe(locked)
  }

  async function lockPreference(): Promise<{ crossDevice: boolean, idleSec: number }> {
    const rows = returnedRows<{ lock_cross_device: boolean, lock_idle_sec: number }>(await api.pgDataSource.query(
      'SELECT lock_cross_device, lock_idle_sec FROM sys_user_lock WHERE user_id = $1',
      [fixture!.userId],
    ))
    expect(rows).toHaveLength(1)
    return { crossDevice: rows[0].lock_cross_device, idleSec: rows[0].lock_idle_sec }
  }

  /** 切锁屏偏好（该端点刻意**不** LockFree：锁定期间不许改偏好绕过锁屏） */
  async function setLockCrossDevice(crossDevice: boolean): Promise<void> {
    const res = await api.root('PATCH', api.apiPath(PREFERENCE_PATH), { lockCrossDevice: crossDevice })
    expectOk(res, `lock preference crossDevice=${crossDevice}`)
    expect((await lockPreference()).crossDevice).toBe(crossDevice)
  }

  async function cacheLocked(): Promise<boolean | null> {
    return app.get(AppTechCacheLockService).checkIsLocked(fixture!.userId, api.deviceId)
  }

  /**
   * 给锁缓存键压一个真实 TTL（与 setDeviceLockCache 同一个键、同一条缓存通道）。
   *
   * 判据取 `expire()` 的返回值（键存在且写入成功才 true）—— **不**断言 `ttl()` 的秒数：
   * 那是「读时钟算差」，负载下读完可能已经跨秒甚至已过期。真实到期由下面的
   * `waitForLockKeyGone` 轮询到「键确实不在了」这个**终态**来确认。
   */
  async function expireLockCache(key: string, seconds: number): Promise<void> {
    const applied = await app.get(AppTechCacheService).expire(key, seconds)
    expect(applied).toBe(true)
  }

  /**
   * 轮询到键消失（语义判据 = 键不在了；超时只作为失败时的兜底上限）。
   * `Date.now()` 在这里只用来给轮询设上限，不参与任何「耗时多久」的断言。
   */
  async function waitForLockKeyGone(key: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!(await api.hasWalnutCacheKey(key))) {
        return
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    expect(await api.hasWalnutCacheKey(key)).toBe(false)
  }

  async function probe(): Promise<number> {
    const res = await api.root('GET', api.apiPath(PROBE_PATH))
    return bodyOf(res).code
  }

  async function lockMe(tag: string): Promise<void> {
    const res = await api.root('PATCH', api.apiPath('/system/user/lock'), {
      lockRoute: { name: `lock-guard-${tag}-${seed8}` },
    })
    expectOk(res, `lock me (${tag})`)
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `lock-guard-${seed8}`)
    tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    // 探针走 MFA guard（#9，在 Lock #11 之前）：设备级 verified 缓存必须先有
    await api.seedMfaVerifiedCache(fixture.userId)

    // 把偏好钉成单设备模式：否则首插走 DB 默认 lock_cross_device=true ⇒ 守卫写全局键
    await setLockCrossDevice(false)

    // 上面那次偏好写入本身走完整守卫链（preference 端点刻意不 LockFree）⇒ 已把
    // locked=false 回填进缓存。基线用例要的是「冷缓存」，这里清干净。
    const cacheService = app.get(AppTechCacheService)
    await cacheService.del(globalLockKey())
    await cacheService.del(deviceLockKey())
  })

  // 每条用例后回到「DB 未锁 + 两个锁键都删掉 + 单设备模式」—— 下一条用例的第一次请求自己回源 DB
  afterEach(async () => {
    if (fixture === null) {
      return
    }
    await api.pgDataSource.query(
      'UPDATE sys_user_device SET locked = false WHERE user_id = $1 AND device_id = $2',
      [fixture.userId, api.deviceId],
    )
    await api.pgDataSource.query('UPDATE sys_user_lock SET lock_cross_device = false WHERE user_id = $1', [fixture.userId])
    const cacheService = app.get(AppTechCacheService)
    await cacheService.del(globalLockKey())
    await cacheService.del(deviceLockKey())
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user_lock WHERE user_id = $1', [fixture.userId])
      await api.pgDataSource.query('UPDATE sys_user_device SET locked = false WHERE user_id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('基线：未锁 ⇒ 20000，且回源 DB 后把 locked=false 回填进设备键', async () => {
    expect(await cacheLocked()).toBeNull()

    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

    expect(await cacheLocked()).toBe(false)
    expect(await api.hasWalnutCacheKey(deviceLockKey())).toBe(true)
  })

  it('PATCH lock ⇒ DB locked=true、设备键 true、探针 40118', async () => {
    await lockMe('lock')

    expect(await dbLocked()).toBe(true)
    expect(await cacheLocked()).toBe(true)
    expect(await api.hasWalnutCacheKey(deviceLockKey())).toBe(true)
    // 单设备模式不写全局键（否则「A 设备锁」会误伤该用户其它设备）
    expect(await api.hasWalnutCacheKey(globalLockKey())).toBe(false)

    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)
  })

  it('TTL 到期 + DB 仍锁 ⇒ 仍 40118（缓存消失不等于解锁），并回填 true', async () => {
    await lockMe('ttl-still')
    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)

    await expireLockCache(deviceLockKey(), 1)
    await waitForLockKeyGone(deviceLockKey())

    // 键已不存在（真实 Redis 过期），守卫必须回源 DB 而不是当作「未锁」放行
    expect(await dbLocked()).toBe(true)
    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)
    expect(await cacheLocked()).toBe(true)
  })

  it('边界：DB 已解 + 缓存仍 true ⇒ 缓存赢（仍 40118）；TTL 到期后 ⇒ 20000 并回填 false', async () => {
    await lockMe('ttl-idle')
    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)

    // 「空闲到期」的另一半：DB 已解锁，但缓存还是 true
    await setDbLocked(false)
    expect(await dbLocked()).toBe(false)
    expect(await cacheLocked()).toBe(true)
    // ⤵ TTL 未到期 ⇒ 读缓存 ⇒ 仍被拦（这正是「TTL 到期」为什么是转折点）
    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)

    // 缓存键到期（真实 Redis TTL）⇒ 守卫回源 DB ⇒ 以 DB 为准放行
    await expireLockCache(deviceLockKey(), 1)
    await waitForLockKeyGone(deviceLockKey())

    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
    expect(await cacheLocked()).toBe(false)
    expect(await api.hasWalnutCacheKey(deviceLockKey())).toBe(true)
  })

  it('显式 unlock 仍是立即生效的恢复通道（与 TTL 到期互补，不是同一条腿）', async () => {
    await lockMe('unlock')
    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)

    const unlockRes = await api.root('PATCH', api.apiPath('/system/user/lock/unlock'), {})
    expectOk(unlockRes, 'unlock me')

    expect(await dbLocked()).toBe(false)
    expect(await cacheLocked()).toBe(false)
    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
  })

  it('边界：锁缓存键被外部清空（Redis 淘汰）时，守卫回源 DB 而不是静默放行', async () => {
    await lockMe('evict')

    await app.get(AppTechCacheService).del(deviceLockKey())
    expect(await cacheLocked()).toBeNull()

    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)
    expect(await cacheLocked()).toBe(true)
  })

  it('边界：锁缓存的 ttl 字段是 0（永不过期 —— 服务端没有按 lockIdleSec 的自动解锁）', async () => {
    await lockMe('ttl-meta')

    // 偏好行存在时 lockIdleSec 走 DB 默认 600（无行时 service 兜底 300）—— 该值只是
    // 交给前端的空闲锁屏秒数，与缓存键无关：
    expect((await lockPreference()).idleSec).toBe(600)

    const whole = await app.get(AppTechCacheService).getWholeCache<boolean>(deviceLockKey())
    expect(whole).not.toBeNull()
    expect(whole!.v).toBe(true)
    expect(whole!.t).toBe(WalnutAdminConstAppCacheType.BUILT_IN)
    // ttl=0 ⇒ set 走无过期分支（AppTechCacheService.set：ttl > 0 才 SETEX）
    expect(whole!.ttl).toBe(0)
    expect(await api.getWalnutCacheTtl(deviceLockKey())).toBe(-1)
  })

  it('跨设备模式（lockCrossDevice=true）⇒ 守卫改写全局键，checkIsLocked 优先读它', async () => {
    await setLockCrossDevice(true)
    // 清掉上一条用例可能残留的键，让「写哪个键」成为本用例唯一变量
    await app.get(AppTechCacheService).del(deviceLockKey())
    await app.get(AppTechCacheService).del(globalLockKey())

    await lockMe('cross')

    expect(await dbLocked()).toBe(true)
    expect(await api.hasWalnutCacheKey(globalLockKey())).toBe(true)
    expect(await api.hasWalnutCacheKey(deviceLockKey())).toBe(false)
    expect(await cacheLocked()).toBe(true)
    expect(await probe()).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)

    // 还原：先解锁再切回单设备（偏好端点在锁定期间不可用，这正是它不挂 LockFree 的原因）
    const unlockRes = await api.root('PATCH', api.apiPath('/system/user/lock/unlock'), {})
    expectOk(unlockRes, 'unlock after cross device probe')
    expect(await dbLocked()).toBe(false)
    await setLockCrossDevice(false)
  })
})

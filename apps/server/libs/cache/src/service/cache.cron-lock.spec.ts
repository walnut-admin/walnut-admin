import type { AppTechCacheService } from '../cache.service'
import { Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppTechCacheCronLockService, CRON_LOCK_ACQUIRE_TIMEOUT_MS } from './cache.cron-lock'

/**
 * W2-A cron 单实例锁单测：
 * 1. 拿到锁 → 执行任务体 → 原子比对释放（deleteIfValue），并透传任务体返回值；
 * 2. 未拿到锁 → warn 后跳过本次 tick（不阻塞、不报错），返回 undefined；
 * 3. Redis 异常 → fail-open：warn 后照常执行（锁只是优化，不能让任务停摆）；
 * 4. 抢锁超时（offline queue 挂起）→ 1s 后 fail-open 无锁执行，且 abandoned 不释放；
 * 5. 任务体抛错 → 异常照常上抛，但锁仍被释放（下一次 tick 可再抢）；
 * 6. 释放时 token 不匹配（TTL 到期、锁已被他人重持）→ 不删对方键；
 * 7. 释放时键已过期（TTL 兜底）→ 无可删，warn 后返回。
 *
 * 用内存 Map + 可推进的假时钟实现 AppTechCacheService 的最小面（setIfAbsent 模拟
 * SET NX EX 的原子语义，deleteIfValue 模拟 EVAL 的比对后删，get 按 TTL 判存活）。
 */
interface FakeEntry {
  value: unknown
  expiresAt: number
}

function createFakeCache(): {
  cache: AppTechCacheService
  store: Map<string, FakeEntry>
  setIfAbsent: ReturnType<typeof vi.fn>
  deleteIfValue: ReturnType<typeof vi.fn>
  advance: (ms: number) => void
} {
  let now = 1_000_000
  const store = new Map<string, FakeEntry>()

  // 读到的值：不存在或 TTL 已过 → null（过期键顺手清掉，模拟 Redis 的惰性删除）
  const readAlive = (key: string): unknown => {
    const entry = store.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt <= now) {
      store.delete(key)
      return null
    }
    return entry.value
  }

  const setIfAbsent = vi.fn(async (key: string, value: unknown, options: { ttl?: number }) => {
    if (readAlive(key) !== null) {
      return false
    }
    store.set(key, { value, expiresAt: now + (options?.ttl ?? 0) * 1000 })
    return true
  })

  // 对齐 cache.service 的 deleteIfValue：值是字符串 token，直接比对后删
  const deleteIfValue = vi.fn(async (key: string, expected: string) => {
    if (readAlive(key) !== expected) {
      return false
    }
    store.delete(key)
    return true
  })

  const cache = {
    setIfAbsent,
    deleteIfValue,
    get: vi.fn(async (key: string) => readAlive(key)),
  } as unknown as AppTechCacheService

  return {
    cache,
    store,
    setIfAbsent,
    deleteIfValue,
    advance: (ms: number) => {
      now += ms
    },
  }
}

/** 取本次 runExclusive 持有的 token（setIfAbsent 写入的第二个实参） */
function heldToken(setIfAbsent: ReturnType<typeof vi.fn>, call = 0): string {
  const args = setIfAbsent.mock.calls[call] as unknown[]
  return args[1] as string
}

describe('appTechCacheCronLockService', () => {
  afterEach(() => {
    // 超时用例用假时钟推进 1s：恢复真实时钟，避免影响同文件后续用例
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('拿到锁：执行任务体，结束后按 token 原子比对释放，并透传返回值', async () => {
    const { cache, store, setIfAbsent, deleteIfValue } = createFakeCache()
    const service = new AppTechCacheCronLockService(cache)
    const fn = vi.fn(async () => 42)

    const result = await service.runExclusive('rotateAppKey', 300, fn)

    expect(result).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(setIfAbsent).toHaveBeenCalledWith('CRON_LOCK:rotateAppKey', expect.any(String), { ttl: 300, t: WalnutAdminConstAppCacheType.BUILT_IN })
    expect(deleteIfValue).toHaveBeenCalledWith('CRON_LOCK:rotateAppKey', heldToken(setIfAbsent))
    expect(store.size).toBe(0)
  })

  it('未拿到锁：warn 后跳过本次 tick，不执行任务体、返回 undefined', async () => {
    const { cache, store, deleteIfValue } = createFakeCache()
    // 模拟另一个实例已持有锁
    store.set('CRON_LOCK:extractAppSetting', { value: 'other-instance-token', expiresAt: Number.POSITIVE_INFINITY })
    const service = new AppTechCacheCronLockService(cache)
    const fn = vi.fn(async () => 1)
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const result = await service.runExclusive('extractAppSetting', 600, fn)

    expect(result).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
    expect(deleteIfValue).not.toHaveBeenCalled()
    // 别人的锁不被释放
    expect(store.get('CRON_LOCK:extractAppSetting')?.value).toBe('other-instance-token')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('redis 异常：fail-open —— warn 后照常执行任务体', async () => {
    const { cache, deleteIfValue } = createFakeCache()
    cache.setIfAbsent = vi.fn(async () => {
      throw new Error('redis down')
    })
    const service = new AppTechCacheCronLockService(cache)
    const fn = vi.fn(async () => undefined)
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await service.runExclusive('updateMfaSetupStatus', 300, fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(deleteIfValue).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('抢锁超时（offline queue 挂起）：1s 后 fail-open 无锁执行，返回任务体结果且不释放（abandoned）', async () => {
    vi.useFakeTimers()
    const { cache, deleteIfValue } = createFakeCache()
    // 模拟断连重连：命令进入 offline queue，既不 resolve 也不 reject
    cache.setIfAbsent = vi.fn(async () => new Promise<boolean>(() => {}))
    const service = new AppTechCacheCronLockService(cache)
    const fn = vi.fn(async () => 42)
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const pending = service.runExclusive('rotateAppKey', 300, fn)

    // 未到超时上限：任务体还没开始跑
    await vi.advanceTimersByTimeAsync(CRON_LOCK_ACQUIRE_TIMEOUT_MS - 1)
    expect(fn).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe(42)

    expect(fn).toHaveBeenCalledTimes(1)
    // 锁状态未知：不能 deleteIfValue（可能删到真实持锁者的键），锁随 TTL 自然过期
    expect(deleteIfValue).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('任务体抛错：异常上抛，finally 仍释放锁', async () => {
    const { cache, store, deleteIfValue } = createFakeCache()
    const service = new AppTechCacheCronLockService(cache)
    const fn = vi.fn(async () => {
      throw new Error('task failed')
    })

    await expect(service.runExclusive('deleteExpiredRefreshToken', 900, fn)).rejects.toThrow('task failed')

    expect(deleteIfValue).toHaveBeenCalledWith('CRON_LOCK:deleteExpiredRefreshToken', expect.any(String))
    expect(store.size).toBe(0)
  })

  it('释放时 token 不匹配（TTL 到期后被他人重持）：不删对方键', async () => {
    const { cache, store, setIfAbsent, deleteIfValue, advance } = createFakeCache()
    const service = new AppTechCacheCronLockService(cache)
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    // 任务体运行期间锁 TTL 到期（任务超时），键被另一实例以新 token 重新持有
    const fn = vi.fn(async () => {
      advance(300_000 + 1_000)
      store.set('CRON_LOCK:rotateAppKey', { value: 'other-instance-token', expiresAt: Number.POSITIVE_INFINITY })
    })

    await service.runExclusive('rotateAppKey', 300, fn)

    // 释放用的是自己的 token，谁持谁删 —— 别人的锁必须原样保留
    expect(deleteIfValue).toHaveBeenCalledWith('CRON_LOCK:rotateAppKey', heldToken(setIfAbsent))
    expect(store.get('CRON_LOCK:rotateAppKey')?.value).toBe('other-instance-token')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('释放时键已过期（TTL 兜底）：无可删，warn 后返回', async () => {
    const { cache, store, deleteIfValue, advance } = createFakeCache()
    const service = new AppTechCacheCronLockService(cache)
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const fn = vi.fn(async () => {
      // 任务超时但无人重持：键已随 TTL 消失
      advance(300_000 + 1_000)
    })

    await service.runExclusive('rotateAppKey', 300, fn)

    expect(deleteIfValue).toHaveBeenCalledWith('CRON_LOCK:rotateAppKey', expect.any(String))
    expect(store.size).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

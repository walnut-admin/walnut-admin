import { describe, expect, it, vi } from 'vitest'
import { MurLockAdapter } from './murlock.adapter'

/**
 * D11：适配器只做**委托**。
 *
 * 为什么值得单独测：端口化的收益是「换实现只改一个文件」，代价是把 vendor 行为藏到
 * 适配器后面 —— 适配器一旦自己加了重试/超时/吞错，10 个消费方的语义会集体变。
 * 这三条用例钉的就是「零额外语义」。
 */
describe('murLock adapter（D11 端口适配器）', () => {
  it('把 (lockKey, releaseTimeMs, fn) 原样透传，并返回临界区结果', async () => {
    const runWithLock = vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn())
    const adapter = new MurLockAdapter({ runWithLock } as never)

    const result = await adapter.runWithLock('APP:MURLOCK:CAP:device-1', 3000, async () => 'ok')

    expect(result).toBe('ok')
    expect(runWithLock).toHaveBeenCalledTimes(1)
    expect(runWithLock).toHaveBeenCalledWith('APP:MURLOCK:CAP:device-1', 3000, expect.any(Function))
  })

  it('临界区抛错原样传给调用方（适配器不吞错、不重试）', async () => {
    const runWithLock = vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn())
    const adapter = new MurLockAdapter({ runWithLock } as never)

    await expect(adapter.runWithLock('k', 200, async () => {
      throw new Error('critical-section-failed')
    })).rejects.toThrow('critical-section-failed')
  })

  it('锁实现自身抛错（Redis 不可达等）原样传播', async () => {
    const runWithLock = vi.fn(async () => {
      throw new Error('redis-unreachable')
    })
    const adapter = new MurLockAdapter({ runWithLock } as never)

    await expect(adapter.runWithLock('k', 200, async () => 'never')).rejects.toThrow('redis-unreachable')
  })
})

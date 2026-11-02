import type { IWalnutAdminCacheListRequest } from './cache-list.types'
import type { AppTechRedisService } from './redis/redis.service'
import { WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { describe, expect, it, vi } from 'vitest'
import { AppTechCacheService } from './cache.service'

/**
 * F-27（CQ-011）：`getAllCacheData` 的 Bull 键过滤此前写在**摊平之前**
 * （`key.includes('BULL')`）—— node-redis v5 的 `scanIterator` 按批产出 `string[]`，
 * 数组上的 `includes` 是「整元素全等」判断，永远不命中 ⇒ Bull 队列键混进 MGET，
 * 缓存监控列表/日志失真（:269-279 的 delByPattern 早已按批量形态摊平，此处漏改）。
 *
 * 本用例从公开入口 `list()` 打进去，钉住两件事：
 * 1. 批量数组里的 BULL 键被逐键过滤（不是整批放过、也不是整批丢弃）；
 * 2. 空批 / 非 BULL 键不受影响（不出现 undefined 混进 MGET 参数）。
 */

interface ICacheEntry {
  key: string
  payload: string
}

/** 造一个 node-redis v5 形态的假 client：scanIterator 依批产出 string[] */
function createRedisStub(batches: string[][], entries: ICacheEntry[]) {
  const mGet = vi.fn(async (keys: string[]) => keys.map((key) => {
    const found = entries.find(entry => entry.key === key)
    return found === undefined ? null : found.payload
  }))

  const client = {
    // 与 node-redis v5 一致：每轮 yield 一批 string[]（含空批）
    async* scanIterator() {
      for (const batch of batches) {
        yield batch
      }
    },
    mGet,
  }

  const redisService = { getClient: () => client } as unknown as AppTechRedisService

  return { service: new AppTechCacheService(redisService), mGet }
}

function listPayload(): IWalnutAdminCacheListRequest {
  return {
    sort: [],
    query: {},
    page: { page: 1, pageSize: 10 },
  }
}

function cacheValue(value: unknown, type = WalnutAdminConstAppCacheType.CONTROLLER) {
  return JSON.stringify({ v: value, ttl: 0, start: Date.now(), t: type })
}

describe('cache list：Bull 键过滤（F-27）', () => {
  it('批量数组里的 BULL 键被逐键过滤掉，不进入 MGET', async () => {
    const normalKey = 'WALNUT_CACHE_USER:1'
    const bullKey = 'WALNUT_CACHE_BULL:email:1'

    const { service, mGet } = createRedisStub(
      // 一个批次里同时含普通键与 Bull 键（修复前整批既没过滤、又靠 includes 判断失败）
      [[normalKey, bullKey]],
      [{ key: normalKey, payload: cacheValue({ id: 1 }) }],
    )

    const result = await service.list(listPayload())

    // MGET 只收到普通键 —— Bull 键在进批之前就被过滤掉
    expect(mGet).toHaveBeenCalledTimes(1)
    expect(mGet.mock.calls[0][0]).toEqual([normalKey])

    // 列表输出同样不含 Bull 键
    expect(result.total).toBe(1)
    expect(result.data.map(row => row.key)).toEqual(['USER:1'])
  })

  it('多批次 + 空批：每批各自摊平过滤，空批不塞 undefined 进 MGET', async () => {
    const keyA = 'WALNUT_CACHE_A'
    const keyB = 'WALNUT_CACHE_B'
    const bullA = 'WALNUT_CACHE_BULL:phone:1'
    const bullB = 'WALNUT_CACHE_BULL:email:2'

    const { service, mGet } = createRedisStub(
      [[], [keyA, bullA], [], [bullB, keyB], []],
      [
        { key: keyA, payload: cacheValue('a') },
        { key: keyB, payload: cacheValue('b') },
      ],
    )

    const result = await service.list(listPayload())

    const requested = mGet.mock.calls.flatMap(call => call[0])
    expect(requested).toEqual([keyA, keyB])
    expect(requested.every(key => typeof key === 'string' && !key.includes('BULL'))).toBe(true)
    expect(result.total).toBe(2)
    expect(result.data.map(row => row.key).sort()).toEqual(['A', 'B'])
  })

  it('整批都是 Bull 键时不会为这一批发 MGET（过滤后为空即跳过）', async () => {
    const { service, mGet } = createRedisStub(
      [['WALNUT_CACHE_BULL:email:1', 'WALNUT_CACHE_BULL:phone:2']],
      [],
    )

    const result = await service.list(listPayload())

    expect(mGet).not.toHaveBeenCalled()
    expect(result.total).toBe(0)
    expect(result.data).toEqual([])
  })
})

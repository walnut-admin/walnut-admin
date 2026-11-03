import { createHash } from 'node:crypto'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { describe, expect, it, vi } from 'vitest'

import { AppTechCacheCapService } from './cache.cap'

/**
 * CAP 校验缓存窗口（review CAP-1 / CAP-2）的**消费侧**钉子。
 *
 * 修复前：`Math.max(1, Math.ceil(config.ttl / 1000))` —— 把 `ttl`（权威单位是秒）当成毫秒，
 * 种子值 3600 部署下缓存窗口只有 **4 秒**（每 4 秒重验一次 ⇒ 40117 风暴）。
 * 修复后：`resolveCapCacheTtlSeconds(ttl)` = `min(ttl, 20min)`，单位是秒。
 *
 * 20 分钟不是拍脑袋：cap.js `redeemChallenge` 把 token 寿命写死成
 * `Date.now() + 20 * 60 * 1000`（@cap.js/server 4.0.5 index.js:343），缓存不得长于它。
 */

const MINUTE = 60

/** `apps/server/db/seed/app_setting.json:46` 的 cap ttl（秒） */
const SEED_TTL_SECONDS = 3600

interface ISetCall {
  key: string
  value: unknown
  options: { t: string, ttl: number }
}

function createService(ttl: number) {
  const setCalls: ISetCall[] = []

  const cacheService = {
    set: vi.fn(async (key: string, value: unknown, options: ISetCall['options']) => {
      setCalls.push({ key, value, options })
    }),
    get: vi.fn(async () => null),
  }

  const cacheAppSettingsService = {
    getCapJSConfig: vi.fn(async () => ({
      count: 10,
      size: 16,
      difficulty: 4,
      ttl,
      throttleLimit: 4,
      throttleTtl: 60,
    })),
  }

  const service = new AppTechCacheCapService(
    cacheService as unknown as ConstructorParameters<typeof AppTechCacheCapService>[0],
    cacheAppSettingsService as unknown as ConstructorParameters<typeof AppTechCacheCapService>[1],
  )

  return { service, setCalls, cacheService }
}

describe('cap token 缓存：窗口 = min(ttl, 20min)，单位秒', () => {
  it('种子 ttl=3600 秒 ⇒ 缓存 ttl=1200 秒（≈20 分钟），不是 4 秒', async () => {
    const { service, setCalls } = createService(SEED_TTL_SECONDS)

    await service.setCapTokenCache('device-a', 'deadbeef:cafebabe')

    expect(setCalls).toHaveLength(1)
    expect(setCalls[0].options.ttl).toBe(20 * MINUTE)
    expect(setCalls[0].options.ttl / 60).toBe(20)
    expect(setCalls[0].options.t).toBe(WalnutAdminConstAppCacheType.AUTH)

    // 旧写法 `Math.ceil(3600 / 1000)` = 4（秒）—— 改回去这一行必红
    expect(setCalls[0].options.ttl).not.toBe(Math.ceil(SEED_TTL_SECONDS / 1000))
    // 缓存窗不得超过 cap.js 硬编码的 token 寿命
    expect(setCalls[0].options.ttl).toBeLessThanOrEqual(20 * MINUTE)
  })

  it('ttl 短于 20 分钟 ⇒ 缓存跟 ttl 走（配置想更严就更严）', async () => {
    const { service, setCalls } = createService(10 * MINUTE)

    await service.setCapTokenCache('device-b', 'deadbeef:cafebabe')

    expect(setCalls[0].options.ttl).toBe(10 * MINUTE)
  })

  it('ttl 长于 20 分钟 ⇒ 缓存封顶 20 分钟（不得放行 cap.js 已过期的 token）', async () => {
    const { service, setCalls } = createService(24 * 60 * MINUTE)

    await service.setCapTokenCache('device-c', 'deadbeef:cafebabe')

    expect(setCalls[0].options.ttl).toBe(20 * MINUTE)
  })

  it('缓存键仍是 deviceId + token 指纹（sha256 前 16 hex），与设备绑定', async () => {
    const { service, setCalls } = createService(SEED_TTL_SECONDS)
    const token = 'deadbeef:cafebabe'
    const fingerprint = createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16)

    await service.setCapTokenCache('device-d', token)

    expect(setCalls[0].key).toBe(
      `${WalnutAdminConstAppCacheKeys.SECURITY_CAP_TOKEN}:device-d:${fingerprint}`,
    )
  })
})

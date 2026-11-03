import { describe, expect, it } from 'vitest'

import {
  normalizeCapTtlSeconds,
  resolveCapCacheTtlSeconds,
  resolveCapChallengeExpiresMs,
  resolveCapCookieMaxAgeMs,
  WalnutAdminConstCapTokenLifetimeSeconds,
  WalnutAdminConstCapTtlDefaultSeconds,
} from './cap'

/**
 * CAP `ttl` 单位统一（review CAP-1 / CAP-2）的钉子。
 *
 * 修复前是**一个配置、三种解释**（没有任何取值能让三处同时正确）：
 * - `cap.service.ts:27` `expiresMs: config.ttl` → 把 ttl 当**毫秒**
 * - `cap.service.ts:36` `maxAge: config.ttl * 1000` → 把 ttl 当**秒**
 * - `cache.cap.ts:39` `Math.ceil(config.ttl / 1000)` → 把 ttl 当**毫秒**再转成秒
 *
 * 现在三处都从 {@link normalizeCapTtlSeconds} 派生；下面每组断言都写成
 * 「等于正确值」**且**「不等于修复前那行代码算出来的值」—— 把任一消费方改回旧写法，
 * 对应断言立刻红（消费侧还有 cap.service.spec.ts / cache.cap.spec.ts 两道同级钉子）。
 */

const MINUTE = 60
const HOUR = 60 * MINUTE

/** `apps/server/db/seed/app_setting.json:46` 的 cap ttl（秒） */
const SEED_TTL_SECONDS = 3600

describe('cap ttl：秒进、按各消费方单位出（种子值 3600 手算）', () => {
  it('三处换算同源一致：challenge ≈ 60 分钟、cookie ≈ 60 分钟、缓存 = min(ttl, 20min) ≈ 20 分钟', () => {
    const challengeExpiresMs = resolveCapChallengeExpiresMs(SEED_TTL_SECONDS)
    const cookieMaxAgeMs = resolveCapCookieMaxAgeMs(SEED_TTL_SECONDS)
    const cacheTtlSeconds = resolveCapCacheTtlSeconds(SEED_TTL_SECONDS)

    // 1) 各自消费方要的单位对得上
    expect(challengeExpiresMs / 1000).toBe(HOUR) // cap.js createChallenge({ expiresMs }) 要毫秒
    expect(cookieMaxAgeMs / 1000).toBe(HOUR) // Express cookie maxAge 要毫秒
    expect(cacheTtlSeconds).toBe(20 * MINUTE) // Redis set 的 ttl 是秒，且窗口被 cap.js 的 20 分钟封顶

    // 2) 三处确实同源：两个毫秒口径必须逐字相等（任何一处漏乘 1000 都会破这条），
    //    缓存窗口必须等于 min(配置 ttl, token 本体寿命)
    expect(challengeExpiresMs).toBe(cookieMaxAgeMs)
    expect(cacheTtlSeconds).toBe(
      Math.min(SEED_TTL_SECONDS, WalnutAdminConstCapTokenLifetimeSeconds),
    )

    // 3) 修复前三种写法算出来的值 —— 全都不等于现在的值（改回任一处，上面就红）
    expect(challengeExpiresMs).not.toBe(SEED_TTL_SECONDS) // 旧 expiresMs: config.ttl → 3600（= 3.6 秒）
    expect(cookieMaxAgeMs).not.toBe(SEED_TTL_SECONDS) // 旧 maxAge 若漏乘 → 3.6 秒
    expect(cacheTtlSeconds).not.toBe(Math.ceil(SEED_TTL_SECONDS / 1000)) // 旧 ceil(ttl/1000) → 4 秒
  })

  it('ttl 短于 token 寿命时缓存跟 ttl 走（配置想更严就更严）', () => {
    expect(resolveCapCacheTtlSeconds(10 * MINUTE)).toBe(10 * MINUTE)
    // 同一取值下 challenge/cookie 仍按 ttl 换算，不受缓存窗口影响
    expect(resolveCapChallengeExpiresMs(10 * MINUTE)).toBe(10 * MINUTE * 1000)
  })

  it('ttl 长于 token 寿命时缓存封顶 20 分钟（不得长于 cap.js 硬编码的 token 寿命）', () => {
    expect(resolveCapCacheTtlSeconds(24 * HOUR)).toBe(20 * MINUTE)
    expect(WalnutAdminConstCapTokenLifetimeSeconds).toBe(20 * MINUTE)
  })
})

describe('cap ttl：归一化边界（缺配置 / 坏 JSON 不允许把缓存变成永不过期）', () => {
  it('非有限 / 非正数回落到缺省值 3600 秒', () => {
    const broken: unknown[] = [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 0, -1, '']

    for (const value of broken) {
      expect(normalizeCapTtlSeconds(value)).toBe(WalnutAdminConstCapTtlDefaultSeconds)
    }

    expect(WalnutAdminConstCapTtlDefaultSeconds).toBe(SEED_TTL_SECONDS)
  })

  it('数字字符串按秒解析（后台表单提交的 JSON 可能把 ttl 写成字符串）', () => {
    expect(normalizeCapTtlSeconds('3600')).toBe(3600)
  })

  it('缓存 TTL 永不为 0（ttl=0 在 Redis set 里是「永不过期」，那等于永久放行）', () => {
    expect(resolveCapCacheTtlSeconds(0)).toBeGreaterThan(0)
    expect(resolveCapCacheTtlSeconds(0.5)).toBeGreaterThan(0)
  })
})

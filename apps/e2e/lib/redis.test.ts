/**
 * `lib/redis.ts` 的**纯函数部分**：fixture 自清理的键模式表。
 *
 * 这里钉的不是 redis.ts 自己（它只是拼字符串），而是两张表的一致性：
 * `deviceScopedKeyPatterns` / `riskDeviceStatePatterns` 必须覆盖 `scripts/redis-gc.ts` 的
 * `DEVICE_KEY_FAMILIES` **每一条** —— 少一条就意味着「一轮绿之后还有设备键残留」，
 * 而那正是 P2-B 实测到的现象（旧表漏了 `risk:rate:device` 与 `risk:challenge:user-device`）。
 *
 * 用**构造的键名**做交叉验证，不连 Redis / PG：GC 那边解析、fixture 这边模式匹配，
 * 两边对同一个键名给出同一个设备 id 才算对齐。
 */
import type { DeviceKeyFamily } from '../scripts/redis-gc.ts'
import { describe, expect, it } from 'vitest'
import { DEVICE_KEY_FAMILIES, parseDeviceKey } from '../scripts/redis-gc.ts'
import { deviceScopedKeyPatterns, riskDeviceStatePatterns } from './redis.ts'

/** 构造一个形态合法的设备 id（d1_ + 32 hex） */
function did(n: number): string {
  return `d1_${n.toString(16).padStart(32, '0')}`
}

const DID = did(1)
const OTHER_DID = did(2)
const USER = 'aefa0706-4102-5438-99f3-85e0683335b8'

/** 每个键族一条**真实拼法**的样本（与 redis-gc.test.ts 的用例同形，故意重复以交叉校验两处表） */
const FAMILY_SAMPLES: Array<{ family: DeviceKeyFamily, key: string }> = [
  { family: 'cache:system:device', key: `WALNUT_CACHE_SYSTEM:DEVICE:${DID}` },
  { family: 'cache:system:device-cookie-renew', key: `WALNUT_CACHE_SYSTEM:DEVICE:COOKIE_RENEW:${DID}` },
  { family: 'cache:auth:sessions', key: `WALNUT_CACHE_AUTH:SESSIONS:${USER}:${DID}:sid-1` },
  { family: 'cache:auth:permissions', key: `WALNUT_CACHE_AUTH:PERMISSIONS:${USER}:${DID}` },
  { family: 'cache:auth:mfa:verified', key: `WALNUT_CACHE_AUTH:MFA:VERIFIED:${USER}:${DID}` },
  { family: 'cache:auth:mfa:totp', key: `WALNUT_CACHE_AUTH:MFA:TOTP:${USER}:${DID}` },
  { family: 'cache:auth:mfa:webauthn', key: `WALNUT_CACHE_AUTH:MFA:WEBAUTN:${USER}:${DID}:registration` },
  { family: 'cache:auth:opaque-state', key: `WALNUT_CACHE_AUTH:OPAQUE_STATE:admin:${DID}:SERVER_STATE` },
  { family: 'cache:security:sign-ticket', key: `WALNUT_CACHE_SECURITY:SIGN:TICKET:${DID}` },
  { family: 'cache:security:sign-aes-key', key: `WALNUT_CACHE_SECURITY:SIGN:AES_KEY:${DID}` },
  { family: 'cache:security:cap-token', key: `WALNUT_CACHE_SECURITY:CAP_TOKEN:${DID}:fingerprint` },
  { family: 'cache:security:rsa-pub-key', key: `WALNUT_CACHE_SECURITY:RSA:PUB_KEY:${DID}` },
  { family: 'cache:security:lock', key: `WALNUT_CACHE_SECURITY:LOCK:${USER}:${DID}` },
  { family: 'risk:device', key: `risk:device:${DID}` },
  { family: 'risk:user-device', key: `risk:user_device:${USER}:${DID}` },
  { family: 'risk:failed-login', key: `risk:failed_login:admin@example.com:${DID}` },
  { family: 'risk:rate:device', key: `risk:rate:device:${DID}:202611252015` },
  { family: 'risk:challenge:device', key: `risk:challenge:device:${DID}:DEVICE_NEW` },
  { family: 'risk:challenge:user-device', key: `risk:challenge:user-device:${USER}:${DID}:USER_DEVICE_UNTRUSTED` },
  { family: 'murlock:cap', key: `APP:MURLOCK:CAP:${DID}` },
  { family: 'murlock:device-ip-change', key: `APP:MURLOCK:DEVICE:IP_CHANGE:${DID}` },
  { family: 'murlock:lock-guard', key: `APP:MURLOCK:LOCK_GUARD:${USER}:${DID}` },
  { family: 'murlock:sign', key: `APP:MURLOCK:SIGN:${DID}` },
  { family: 'murlock:risk-failed-login', key: `APP:MURLOCK:RISK:FAILED_LOGIN:${DID}:admin@example.com` },
]

/** Redis 的 SCAN MATCH 语义子集：`*` 是唯一的通配符，其余字符按字面匹配 */
function matchesPattern(key: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(key)
}

function allPatterns(deviceId: string): string[] {
  return [...deviceScopedKeyPatterns(deviceId), ...riskDeviceStatePatterns(deviceId)]
}

describe('fixture 清理键模式表', () => {
  it('覆盖 redis-gc 的每个设备键族（少一条 = 一轮绿之后仍有残留）', () => {
    expect(new Set(FAMILY_SAMPLES.map(sample => sample.family)))
      .toEqual(new Set(DEVICE_KEY_FAMILIES.map(rule => rule.family)))
  })

  const patterns = allPatterns(DID)

  for (const { family, key } of FAMILY_SAMPLES) {
    it(`${family}：样本键被清理模式命中`, () => {
      const parsed = parseDeviceKey(key)
      expect(parsed?.family, `样本键与 GC 键形表不一致：${key}`).toBe(family)
      expect(parsed?.deviceId, `样本键的设备槽位不是 ${DID}：${key}`).toBe(DID)
      expect(
        patterns.filter(pattern => matchesPattern(key, pattern)),
        `${key} 没有任何 fixture 清理模式命中`,
      ).not.toHaveLength(0)
    })

    it(`${family}：清理模式只钉本设备（换成另一台设备不命中）`, () => {
      const otherKey = key.replace(DID, OTHER_DID)
      expect(otherKey).not.toBe(key)
      for (const pattern of patterns) {
        expect(matchesPattern(otherKey, pattern), `${otherKey} 被本设备的模式错误命中：${pattern}`).toBe(false)
      }
    })
  }

  it('两条新增键族：user-device challenge 与 rate:device 都被覆盖', () => {
    expect(riskDeviceStatePatterns(DID)).toContain(`risk:challenge:user-device:*:${DID}:*`)
    expect(riskDeviceStatePatterns(DID)).toContain(`risk:rate:device:${DID}:*`)
  })

  it('模式里永远带本设备 id（没有整库通配）', () => {
    for (const pattern of allPatterns(DID)) {
      expect(pattern).toContain(DID)
      expect(pattern).not.toBe('*')
      expect(pattern).not.toBe('*:*')
    }
  })
})

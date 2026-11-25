/**
 * `scripts/redis-gc.ts` 的纯函数部分：键形解析（扫描 → 分组）与对账判定。
 *
 * 为什么值得钉：删除面只由这两个函数决定 —— 键形表少一条就漏清、槽位下标错一位就会把
 * userId 当 deviceId 去查库（查不到 ⇒ 误删有效设备的键）。这里用**构造的键名**把每种
 * 键族钉死，不连 Redis / PG。
 */
import { describe, expect, it } from 'vitest'
import {
  chunkKeys,
  DEVICE_ID_PATTERN,
  DEVICE_KEY_FAMILIES,
  DEVICE_KEY_SCAN_PATTERNS,
  parseDeviceKey,
  planRedisGc,
} from './redis-gc.ts'

/** 构造一个形态合法的设备 id（d1_ + 32 hex） */
function did(n: number): string {
  return `d1_${n.toString(16).padStart(32, '0')}`
}

const USER = 'aefa0706-4102-5438-99f3-85e0683335b8'

describe('device id 形态判据（DEVICE_ID_PATTERN）', () => {
  it('接受服务端签发的 d1_ + 32 位小写 hex', () => {
    expect(DEVICE_ID_PATTERN.test(did(1))).toBe(true)
  })

  it('拒掉旧形态（64 hex）与伪造串', () => {
    expect(DEVICE_ID_PATTERN.test('a'.repeat(64))).toBe(false)
    expect(DEVICE_ID_PATTERN.test('d1_ABC')).toBe(false)
    expect(DEVICE_ID_PATTERN.test('')).toBe(false)
  })
})

describe('parseDeviceKey', () => {
  const cases: Array<[name: string, key: string, family: string]> = [
    ['设备缓存', `WALNUT_CACHE_SYSTEM:DEVICE:${did(1)}`, 'cache:system:device'],
    ['设备续期时间闸', `WALNUT_CACHE_SYSTEM:DEVICE:COOKIE_RENEW:${did(1)}`, 'cache:system:device-cookie-renew'],
    ['登录会话', `WALNUT_CACHE_AUTH:SESSIONS:${USER}:${did(1)}:sid-1`, 'cache:auth:sessions'],
    ['权限', `WALNUT_CACHE_AUTH:PERMISSIONS:${USER}:${did(1)}`, 'cache:auth:permissions'],
    ['MFA verified', `WALNUT_CACHE_AUTH:MFA:VERIFIED:${USER}:${did(1)}`, 'cache:auth:mfa:verified'],
    ['MFA totp', `WALNUT_CACHE_AUTH:MFA:TOTP:${USER}:${did(1)}`, 'cache:auth:mfa:totp'],
    ['MFA webauthn', `WALNUT_CACHE_AUTH:MFA:WEBAUTN:${USER}:${did(1)}:registration`, 'cache:auth:mfa:webauthn'],
    ['OPAQUE 状态', `WALNUT_CACHE_AUTH:OPAQUE_STATE:admin:${did(1)}:SERVER_STATE`, 'cache:auth:opaque-state'],
    ['签名 ticket', `WALNUT_CACHE_SECURITY:SIGN:TICKET:${did(1)}`, 'cache:security:sign-ticket'],
    ['签名 AES key', `WALNUT_CACHE_SECURITY:SIGN:AES_KEY:${did(1)}`, 'cache:security:sign-aes-key'],
    ['CAP token', `WALNUT_CACHE_SECURITY:CAP_TOKEN:${did(1)}:fingerprint`, 'cache:security:cap-token'],
    ['RSA 公钥', `WALNUT_CACHE_SECURITY:RSA:PUB_KEY:${did(1)}`, 'cache:security:rsa-pub-key'],
    ['用户-设备锁', `WALNUT_CACHE_SECURITY:LOCK:${USER}:${did(1)}`, 'cache:security:lock'],
    ['风控设备缓存', `risk:device:${did(1)}`, 'risk:device'],
    ['风控用户-设备缓存', `risk:user_device:${USER}:${did(1)}`, 'risk:user-device'],
    ['失败登录', `risk:failed_login:admin@example.com:${did(1)}`, 'risk:failed-login'],
    ['rate 计数（device）', `risk:rate:device:${did(1)}:202611252015`, 'risk:rate:device'],
    ['challenge（device）', `risk:challenge:device:${did(1)}:DEVICE_NEW`, 'risk:challenge:device'],
    ['challenge（user-device）', `risk:challenge:user-device:${USER}:${did(1)}:USER_DEVICE_UNTRUSTED`, 'risk:challenge:user-device'],
    ['murlock CAP', `APP:MURLOCK:CAP:${did(1)}`, 'murlock:cap'],
    ['murlock IP 变更', `APP:MURLOCK:DEVICE:IP_CHANGE:${did(1)}`, 'murlock:device-ip-change'],
    ['murlock 锁守卫', `APP:MURLOCK:LOCK_GUARD:${USER}:${did(1)}`, 'murlock:lock-guard'],
    ['murlock 签名', `APP:MURLOCK:SIGN:${did(1)}`, 'murlock:sign'],
    ['murlock 失败登录', `APP:MURLOCK:RISK:FAILED_LOGIN:${did(1)}:admin@example.com`, 'murlock:risk-failed-login'],
  ]

  for (const [name, key, family] of cases) {
    it(`${name}：${key}`, () => {
      expect(parseDeviceKey(key)).toEqual({ key, family, deviceId: did(1) })
    })
  }

  it('长前缀优先：COOKIE_RENEW 不会被 SYSTEM:DEVICE 抢走', () => {
    expect(parseDeviceKey(`WALNUT_CACHE_SYSTEM:DEVICE:COOKIE_RENEW:${did(2)}`)?.family)
      .toBe('cache:system:device-cookie-renew')
  })

  it('非设备键不属于任何键族（不进入删除面）', () => {
    for (const key of [
      'WALNUT_CACHE_APP:SETTING',
      'WALNUT_CACHE_SYSTEM:LOCALE:ZH_CN',
      'WALNUT_CACHE_SECURITY:SIGN:NONCE:abc123',
      'risk:location:127.0.0.1',
      'risk:rate:ip:127.0.0.1:12345',
      `risk:user:${USER}`,
      'APP:MURLOCK:AREA:CACHE:foo',
    ]) {
      expect(parseDeviceKey(key), key).toBeNull()
    }
  })

  it('设备槽位不是合法形态 ⇒ deviceId=null（只统计，不删）', () => {
    expect(parseDeviceKey(`WALNUT_CACHE_SECURITY:LOCK:${USER}:global`)?.deviceId).toBeNull()
    expect(parseDeviceKey(`WALNUT_CACHE_SYSTEM:DEVICE:${'a'.repeat(64)}`)?.deviceId).toBeNull()
    expect(parseDeviceKey('WALNUT_CACHE_SYSTEM:DEVICE:not-a-device')?.deviceId).toBeNull()
  })

  it('每个键族前缀都被至少一个 SCAN 模式覆盖（漏一条就漏清一类键）', () => {
    for (const rule of DEVICE_KEY_FAMILIES) {
      const covered = DEVICE_KEY_SCAN_PATTERNS.some(pattern => rule.prefix.startsWith(pattern.slice(0, -1)))
      expect(covered, `${rule.family} 的前缀 ${rule.prefix} 没有被 SCAN 模式覆盖`).toBe(true)
    }
  })
})

describe('planRedisGc', () => {
  it('孤儿 = deviceId 合法且不在 sys_device；有效设备保留；未知槽位跳过；非设备键忽略', () => {
    const existing = new Set([did(1)])
    const keys = [
      // 3 个孤儿设备（每个 1–2 个键）
      `risk:device:${did(2)}`,
      `risk:challenge:device:${did(2)}:DEVICE_NEW`,
      `WALNUT_CACHE_SECURITY:RSA:PUB_KEY:${did(3)}`,
      `WALNUT_CACHE_SECURITY:LOCK:${USER}:${did(3)}`,
      `WALNUT_CACHE_AUTH:SESSIONS:${USER}:${did(4)}:sid`,
      // 有效设备
      `WALNUT_CACHE_SYSTEM:DEVICE:${did(1)}`,
      // 跳过与忽略
      `WALNUT_CACHE_SECURITY:LOCK:${USER}:global`,
      'WALNUT_CACHE_APP:SETTING',
    ]

    const plan = planRedisGc(keys, existing)

    expect(plan.orphans.map(item => item.key)).toEqual([
      `risk:device:${did(2)}`,
      `risk:challenge:device:${did(2)}:DEVICE_NEW`,
      `WALNUT_CACHE_SECURITY:RSA:PUB_KEY:${did(3)}`,
      `WALNUT_CACHE_SECURITY:LOCK:${USER}:${did(3)}`,
      `WALNUT_CACHE_AUTH:SESSIONS:${USER}:${did(4)}:sid`,
    ])
    expect(new Set(plan.orphans.map(item => item.deviceId))).toEqual(new Set([did(2), did(3), did(4)]))
    expect(plan.kept.map(item => item.key)).toEqual([`WALNUT_CACHE_SYSTEM:DEVICE:${did(1)}`])
    expect(plan.skipped.map(item => item.key)).toEqual([`WALNUT_CACHE_SECURITY:LOCK:${USER}:global`])
    expect(plan.ignored).toEqual(['WALNUT_CACHE_APP:SETTING'])
    expect(plan.deviceKeys).toHaveLength(6)
  })

  it('同一个键在多个扫描模式里重复出现时只算一次', () => {
    const key = `WALNUT_CACHE_SYSTEM:DEVICE:COOKIE_RENEW:${did(9)}`
    const plan = planRedisGc([key, key], new Set())
    expect(plan.orphans).toHaveLength(1)
    expect(plan.deviceKeys).toHaveLength(1)
  })

  it('空输入 → 空计划', () => {
    expect(planRedisGc([], new Set())).toEqual({ deviceKeys: [], kept: [], orphans: [], skipped: [], ignored: [] })
  })
})

describe('chunkKeys', () => {
  it('按上限切块，最后一块可以不满', () => {
    expect(chunkKeys([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkKeys([], 2)).toEqual([])
  })
})

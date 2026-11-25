/**
 * E2E 的 Redis 直连（独立实例 6380）。只在「精确删自己造的那几个键」时使用：设备缓存、
 * 滑动续期时间闸、该设备的登录会话 / 权限 / MFA / 签名 / CAP 键（清单见
 * {@link deleteDeviceScopedKeys}）、以及风控状态。
 *
 * **不做 FLUSHDB / FLUSHALL**（compose 里这两个命令已被重命名禁用）：E2E 与 dev 虽在同一台
 * 机器，清理必须按 deviceId 精确命中；顺手清库会把同机其它会话的数据一起带走。
 */
import type { RedisClientType } from 'redis'
import { createClient } from 'redis'
import {
  assertE2eRedisPort,
  E2E_REDIS_HOST,
  E2E_REDIS_PASS,
  E2E_REDIS_PORT,
} from '../scripts/env.ts'

/** `AppTechCacheService` 的全局前缀（cache.service.ts 的 getWalnutAdminCacheKey） */
const CACHE_PREFIX = 'WALNUT_CACHE'
const SYS_DEVICE = 'SYSTEM:DEVICE'
const SYS_DEVICE_COOKIE_RENEW = 'SYSTEM:DEVICE:COOKIE_RENEW'

function deviceCacheKey(deviceId: string): string {
  return `${CACHE_PREFIX}_${SYS_DEVICE}:${deviceId}`
}

export function deviceCookieRenewKey(deviceId: string): string {
  return `${CACHE_PREFIX}_${SYS_DEVICE_COOKIE_RENEW}:${deviceId}`
}

export type E2eRedisClient = RedisClientType

async function connectRedis(): Promise<E2eRedisClient> {
  assertE2eRedisPort(E2E_REDIS_PORT)
  const client = createClient({
    socket: { host: E2E_REDIS_HOST, port: E2E_REDIS_PORT },
    password: E2E_REDIS_PASS,
  })
  client.on('error', error => console.error('[e2e/redis]', error))
  await client.connect()
  return client as E2eRedisClient
}

/** 用完自动 quit 的包装（quit 失败不掩盖真正的断言错误） */
export async function withRedis<T>(run: (client: E2eRedisClient) => Promise<T>): Promise<T> {
  const client = await connectRedis()
  try {
    return await run(client)
  }
  finally {
    await client.quit().catch(() => {})
  }
}

/** 删除该设备的两个键（U9 / 续期 / 自清理用；不触碰其它键） */
export async function deleteDeviceKeys(client: E2eRedisClient, deviceId: string): Promise<number> {
  return client.del([deviceCacheKey(deviceId), deviceCookieRenewKey(deviceId)])
}

/** 风险模块的设备缓存（键形如 `risk:device:<deviceId>`；TTL 10 分钟） */
export function riskDeviceKey(deviceId: string): string {
  return `risk:device:${deviceId}`
}

/**
 * 已处理的 critical factor 标记键的 SCAN 模式（`risk:challenge:device:<deviceId>:<FACTOR>`）。
 * 与 {@link deleteRiskDeviceState} 同一键形：清理与用例断言共用一处，别在 spec 里手拼。
 */
export function riskChallengeKeyPattern(deviceId: string): string {
  return `risk:challenge:device:${deviceId}:*`
}

/** 读风险评估结果（factors / level / score），没评估过返回 null */
export async function readRiskDevice(client: E2eRedisClient, deviceId: string): Promise<{ factors?: string[], score?: number, level?: string } | null> {
  const raw = await client.get(riskDeviceKey(deviceId))
  return raw === null ? null : JSON.parse(raw) as { factors?: string[], score?: number, level?: string }
}

/**
 * 该设备的**风控状态**键模式（全族，逐条对齐 `scripts/redis-gc.ts` 的 `DEVICE_KEY_FAMILIES`
 * 里 `risk:*` 那几条，以及各服务的键拼法）：
 *
 * - `risk:device:<deviceId>`（device.service，TTL 10min）
 * - `risk:user_device:<userId>:<deviceId>`（user_device.service，TTL 10min）
 * - `risk:failed_login:<identifier>:<deviceId>`（failedLogin.service，末段 = deviceId）
 * - `risk:rate:device:<deviceId>:<minuteKey>`（rate.service 的 `buildKey('device', …)`）
 * - `risk:challenge:device:<deviceId>:<FACTOR>`（challenge.service，DEVICE_ 前缀因子）
 * - `risk:challenge:user-device:<userId>:<deviceId>:<FACTOR>`（challenge.service，USER_DEVICE_ 前缀因子）
 *
 * 后两族（`rate:device` / `challenge:user-device`）是 P2-B 实测的跨轮残留来源：旧清理只认
 * `risk:device` 与 `risk:challenge:device`，它们每轮都会按新 deviceId 重新长出来。
 */
export function riskDeviceStatePatterns(deviceId: string): string[] {
  return [
    riskDeviceKey(deviceId),
    `risk:user_device:*:${deviceId}`,
    `risk:failed_login:*:${deviceId}`,
    `risk:rate:device:${deviceId}:*`,
    riskChallengeKeyPattern(deviceId),
    `risk:challenge:user-device:*:${deviceId}:*`,
  ]
}

/**
 * 清掉该设备的**风控状态**：评估缓存（device / user_device）、失败登录计数、rate 计数、
 * 以及所有已处理的 critical factor 标记（device 与 user-device 两个 scope）。
 *
 * 为什么必须清：DEVICE_NEW / DEVICE_RECENT 的挑战标记一旦写入（CAP 解完就写），下一次
 * 请求即使风险因子仍在也会被判「已处理」；回填 created_at 后不清标记，cap-widget 不会出现。
 * rate 计数与 user-device 评估缓存同理：它们是「按 deviceId 生长、TTL 5–10 分钟」的键，
 * 留着就会跨轮占内存，也让「这个设备到底清干净没有」无从判断。
 */
export async function deleteRiskDeviceState(client: E2eRedisClient, deviceId: string): Promise<number> {
  return deleteByPatterns(client, riskDeviceStatePatterns(deviceId))
}

/** 按精确前缀扫键（只用于断言/清理本设备范围，不做全库扫描写入） */
export async function scanKeys(client: E2eRedisClient, match: string): Promise<string[]> {
  const keys: string[] = []
  for await (const key of client.scanIterator({ MATCH: match, COUNT: 200 })) {
    keys.push(...(Array.isArray(key) ? key : [key]))
  }
  return keys
}

/** 「登出」的会话一半：删掉该设备上的登录会话键（`AUTH:SESSIONS:<userId>:<deviceId>:<sid>`） */
export async function deleteAuthSessionsForDevice(client: E2eRedisClient, deviceId: string): Promise<number> {
  return deleteByPatterns(client, [`${CACHE_PREFIX}_AUTH:SESSIONS:*:${deviceId}:*`])
}

/**
 * 该设备的**应用缓存**键模式（全族，逐条对齐 `scripts/redis-gc.ts` 的 `DEVICE_KEY_FAMILIES`
 * 里 `cache:*` / `murlock:*` 那几条，以及服务端的 `WalnutAdminConstAppCacheKeys` 拼法）：
 *
 * - `SYSTEM:DEVICE:<deviceId>` / `SYSTEM:DEVICE:COOKIE_RENEW:<deviceId>`（device.cache）
 * - `AUTH:SESSIONS:<userId>:<deviceId>:<sid>`（session.service）
 * - `AUTH:PERMISSIONS:<userId>:<deviceId>`（permissions.cache）
 * - `AUTH:MFA:VERIFIED:<userId>:<deviceId>` / `AUTH:MFA:TOTP:<userId>:<deviceId>`
 *   / `AUTH:MFA:WEBAUTN:<userId>:<deviceId>:<type>`（mfa.cache）
 * - `AUTH:OPAQUE_STATE:<userName>:<deviceId>:SERVER_STATE|SESSION_KEY`（opaque.cache）
 * - `SECURITY:SIGN:TICKET:<deviceId>` / `SECURITY:SIGN:AES_KEY:<deviceId>`（sign.cache）
 * - `SECURITY:CAP_TOKEN:<deviceId>:<tokenFingerprint>`（cap.cache）
 * - `SECURITY:RSA:PUB_KEY:<deviceId>`（cache.rsa）
 * - `SECURITY:LOCK:<userId>:<deviceId>`（lock cache）
 * - `APP:MURLOCK:CAP:<deviceId>` / `APP:MURLOCK:SIGN:<deviceId>` /
 *   `APP:MURLOCK:DEVICE:IP_CHANGE:<deviceId>` / `APP:MURLOCK:LOCK_GUARD:<userId>:<deviceId>` /
 *   `APP:MURLOCK:RISK:FAILED_LOGIN:<deviceId>:<identifier>`（各 guard 的分布式锁）
 *
 * 存在的意义：断言失败时用例末尾的手写清理会被跳过，这些键会跨轮存活（例如 TOTP 的 30s 窗口
 * 键、CAP token 的指纹键），下一轮同 deviceId 不会复现（deviceId 随机），但它们会一直占着栈的
 * 内存与「这个设备到底清干净没有」的判断面。fixture 统一调这里兜底。
 */
export function deviceScopedKeyPatterns(deviceId: string): string[] {
  return [
    deviceCacheKey(deviceId),
    deviceCookieRenewKey(deviceId),
    `${CACHE_PREFIX}_AUTH:SESSIONS:*:${deviceId}:*`,
    `${CACHE_PREFIX}_AUTH:PERMISSIONS:*:${deviceId}`,
    `${CACHE_PREFIX}_AUTH:MFA:VERIFIED:*:${deviceId}`,
    `${CACHE_PREFIX}_AUTH:MFA:TOTP:*:${deviceId}`,
    `${CACHE_PREFIX}_AUTH:MFA:WEBAUTN:*:${deviceId}:*`,
    `${CACHE_PREFIX}_AUTH:OPAQUE_STATE:*:${deviceId}:*`,
    `${CACHE_PREFIX}_SECURITY:SIGN:TICKET:${deviceId}`,
    `${CACHE_PREFIX}_SECURITY:SIGN:AES_KEY:${deviceId}`,
    `${CACHE_PREFIX}_SECURITY:CAP_TOKEN:${deviceId}:*`,
    `${CACHE_PREFIX}_SECURITY:RSA:PUB_KEY:${deviceId}`,
    `${CACHE_PREFIX}_SECURITY:LOCK:*:${deviceId}`,
    `APP:MURLOCK:CAP:${deviceId}`,
    `APP:MURLOCK:DEVICE:IP_CHANGE:${deviceId}`,
    `APP:MURLOCK:LOCK_GUARD:*:${deviceId}`,
    `APP:MURLOCK:SIGN:${deviceId}`,
    `APP:MURLOCK:RISK:FAILED_LOGIN:${deviceId}:*`,
  ]
}

/**
 * 删掉该设备上的**全部** Redis 键（用例收尾的自清理用）。**不 FLUSHDB**。
 *
 * 键形见 {@link deviceScopedKeyPatterns}；风控状态见 {@link riskDeviceStatePatterns}
 * （fixture 两处都调，见 `lib/device-fixtures.ts` 的 `cleanupDevices`）。
 */
export async function deleteDeviceScopedKeys(client: E2eRedisClient, deviceId: string): Promise<number> {
  return deleteByPatterns(client, deviceScopedKeyPatterns(deviceId))
}

/** 按一组精确键 / 模式扫键并删掉命中项（SCAN 不阻塞，命中为 0 时不发 DEL） */
async function deleteByPatterns(client: E2eRedisClient, patterns: readonly string[]): Promise<number> {
  const keys: string[] = []
  for (const pattern of patterns) {
    keys.push(...await scanKeys(client, pattern))
  }
  return keys.length === 0 ? 0 : client.del(keys)
}

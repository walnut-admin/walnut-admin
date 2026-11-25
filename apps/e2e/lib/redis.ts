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

export function deviceCacheKey(deviceId: string): string {
  return `${CACHE_PREFIX}_${SYS_DEVICE}:${deviceId}`
}

export function deviceCookieRenewKey(deviceId: string): string {
  return `${CACHE_PREFIX}_${SYS_DEVICE_COOKIE_RENEW}:${deviceId}`
}

export type E2eRedisClient = RedisClientType

export async function connectRedis(): Promise<E2eRedisClient> {
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

/** 读设备缓存（不存在返回 null）；值由 cache.service 包成 `{ v, t, ttl? }` JSON */
export async function getDeviceCache(client: E2eRedisClient, deviceId: string): Promise<Record<string, unknown> | null> {
  const raw = await client.get(deviceCacheKey(deviceId))
  return raw === null ? null : JSON.parse(raw) as Record<string, unknown>
}

/** 删除该设备的两个键（U9 / 续期 / 自清理用；不触碰其它键） */
export async function deleteDeviceKeys(client: E2eRedisClient, deviceId: string): Promise<number> {
  return client.del([deviceCacheKey(deviceId), deviceCookieRenewKey(deviceId)])
}

/** 风险模块的设备缓存（键形如 `risk:device:<deviceId>`；TTL 10 分钟） */
export function riskDeviceKey(deviceId: string): string {
  return `risk:device:${deviceId}`
}

/** 读风险评估结果（factors / level / score），没评估过返回 null */
export async function readRiskDevice(client: E2eRedisClient, deviceId: string): Promise<{ factors?: string[], score?: number, level?: string } | null> {
  const raw = await client.get(riskDeviceKey(deviceId))
  return raw === null ? null : JSON.parse(raw) as { factors?: string[], score?: number, level?: string }
}

/**
 * 清掉该设备的**风控状态**：评估缓存 + 所有已处理的 critical factor 标记
 * （`risk:challenge:device:<deviceId>:<FACTOR>`）。
 *
 * 为什么必须清：DEVICE_NEW / DEVICE_RECENT 的挑战标记一旦写入（CAP 解完就写），下一次
 * 请求即使风险因子仍在也会被判「已处理」；回填 created_at 后不清标记，cap-widget 不会出现。
 */
export async function deleteRiskDeviceState(client: E2eRedisClient, deviceId: string): Promise<number> {
  const keys: string[] = [riskDeviceKey(deviceId)]
  for await (const key of client.scanIterator({ MATCH: `risk:challenge:device:${deviceId}:*`, COUNT: 100 })) {
    keys.push(...(Array.isArray(key) ? key : [key]))
  }
  return client.del(keys)
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
 * 删掉该设备上的**全部** Redis 键（用例收尾的自清理用）。**不 FLUSHDB**。
 *
 * 键形逐条对齐服务端的 `WalnutAdminConstAppCacheKeys`（apps/server/libs/const/src/app/cache.ts）
 * 与各 `*.cache.ts` 的拼法 —— 服务端改键形时这里要同步：
 *
 * - `SYSTEM:DEVICE:<deviceId>` / `SYSTEM:DEVICE:COOKIE_RENEW:<deviceId>`（device.cache）
 * - `AUTH:SESSIONS:<userId>:<deviceId>:<sid>`（session.service）
 * - `AUTH:PERMISSIONS:<userId>:<deviceId>`（permissions.cache）
 * - `AUTH:MFA:VERIFIED:<userId>:<deviceId>` / `AUTH:MFA:TOTP:<userId>:<deviceId>`（mfa.cache）
 * - `AUTH:OPAQUE_STATE:<userName>:<deviceId>:SERVER_STATE|SESSION_KEY`（opaque.cache）
 * - `SECURITY:SIGN:TICKET:<deviceId>` / `SECURITY:SIGN:AES_KEY:<deviceId>`（sign.cache）
 * - `SECURITY:CAP_TOKEN:<deviceId>:<tokenFingerprint>`（cap.cache）
 *
 * 存在的意义：断言失败时用例末尾的手写清理会被跳过，这些键会跨轮存活（例如 TOTP 的 30s 窗口
 * 键、CAP token 的指纹键），下一轮同 deviceId 不会复现（deviceId 随机），但它们会一直占着栈的
 * 内存与「这个设备到底清干净没有」的判断面。fixture 统一调这里兜底。
 */
export async function deleteDeviceScopedKeys(client: E2eRedisClient, deviceId: string): Promise<number> {
  return deleteByPatterns(client, [
    deviceCacheKey(deviceId),
    deviceCookieRenewKey(deviceId),
    `${CACHE_PREFIX}_AUTH:SESSIONS:*:${deviceId}:*`,
    `${CACHE_PREFIX}_AUTH:PERMISSIONS:*:${deviceId}`,
    `${CACHE_PREFIX}_AUTH:MFA:VERIFIED:*:${deviceId}`,
    `${CACHE_PREFIX}_AUTH:MFA:TOTP:*:${deviceId}`,
    `${CACHE_PREFIX}_AUTH:OPAQUE_STATE:*:${deviceId}:*`,
    `${CACHE_PREFIX}_SECURITY:SIGN:TICKET:${deviceId}`,
    `${CACHE_PREFIX}_SECURITY:SIGN:AES_KEY:${deviceId}`,
    `${CACHE_PREFIX}_SECURITY:CAP_TOKEN:${deviceId}:*`,
  ])
}

/** 按一组精确键 / 模式扫键并删掉命中项（SCAN 不阻塞，命中为 0 时不发 DEL） */
async function deleteByPatterns(client: E2eRedisClient, patterns: readonly string[]): Promise<number> {
  const keys: string[] = []
  for (const pattern of patterns) {
    keys.push(...await scanKeys(client, pattern))
  }
  return keys.length === 0 ? 0 : client.del(keys)
}

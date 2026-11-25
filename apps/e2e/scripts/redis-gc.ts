/**
 * Redis 设备键对账：**按 deviceId 精确删孤儿键**，绝不 FLUSHDB / FLUSHALL（不变量 5）。
 *
 * ## 它解决什么
 *
 * 每轮 E2E 都会签发新的 deviceId（`d1_` + 32 hex）。设备键（设备缓存、滑动续期时间闸、
 * 登录会话 / 权限 / MFA / 签名 / CAP、风控缓存与 challenge 标记）都有 TTL，但 TTL 不短
 * （RSA 公钥 30 天、challenge 24 小时），崩溃 / 中断 / 失败收尾的 run 会把它们留在栈里
 * 跨轮存活。restore 只清两个 app setting 键，不会碰这些 —— 于是一个「设备已经不存在的
 * 键」会一直占着内存，也会污染「这个设备到底清干净没有」的判断面。
 *
 * ## 判据（两步，缺一不可）
 *
 * 1. **键形可识别**：只认 {@link DEVICE_KEY_FAMILIES} 列出的键形（逐条对齐服务端的
 *    `WalnutAdminConstAppCacheKeys` 与各 `*.cache.ts` / risk 模块的拼法）。设备 id 必须落在
 *    该键形**已知的槽位**上，且通过形态判据（`d1_` + 32 位小写 hex，与
 *    `apps/server/libs/const/src/app/device.ts` 同形）。
 * 2. **设备不存在**：该 deviceId 在 `sys_device` 里查不到（`SELECT … WHERE device_id = ANY`）。
 *    只要设备行还在，它的键一个都不动 —— 行存在意味着「可能还有效」。
 *
 * 删除动作是 `DEL <scan 到的那些精确键>`，不是按模式删：SCAN 只负责发现，判据通过才 DEL。
 * 非设备键（`WALNUT_CACHE_APP:SETTING`、语言 / 地区缓存、`risk:location:*`、`SECURITY:SIGN:NONCE:*`…）
 * 根本不会进入删除面。compose 里 `FLUSHDB` / `FLUSHALL` 已被重命名为空串禁用，本脚本也不会调用它们。
 *
 * ## 接入点
 *
 * `scripts/run.ts`：锁内、`ensureTestDatabase` 之后（restore 或全量 prepare 都算），
 * 默认执行；`E2E_REDIS_GC=0` 关掉。默认开是因为这一轮的库刚被重建，「不在库里的设备」
 * 就是**确定的**孤儿；失败只报警（cleanup 不该把一轮测试拦下来）。
 * 独立入口：`node scripts/redis-gc.ts [--dry-run]`（排障 / 负对照用）。
 */
import type { RedisClientType } from 'redis'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createClient } from 'redis'
import { withPg } from '../lib/pg.ts'
import {
  assertE2eRedisPort,
  E2E_REDIS_HOST,
  E2E_REDIS_PASS,
  E2E_REDIS_PORT,
} from './env.ts'
import { E2ePreconditionError } from './failure.ts'

/**
 * 设备 id 形态（与 `apps/server/libs/const/src/app/device.ts` 的判据同形）。
 *
 * 只接受服务端签发的形态：旧形态（64 位 hex）与伪造串一律不进删除面 —— 宁可留下一个
 * 形态不认识的键（计入 skipped），也不要按「猜出来的 deviceId」误删。
 */
export const DEVICE_ID_PATTERN = /^d1_[0-9a-f]{32}$/

/** 键族（报告分组用；与 {@link DEVICE_KEY_FAMILIES} 一一对应） */
export type DeviceKeyFamily
  = | 'cache:system:device'
    | 'cache:system:device-cookie-renew'
    | 'cache:auth:sessions'
    | 'cache:auth:permissions'
    | 'cache:auth:mfa:verified'
    | 'cache:auth:mfa:totp'
    | 'cache:auth:mfa:webauthn'
    | 'cache:auth:opaque-state'
    | 'cache:security:sign-ticket'
    | 'cache:security:sign-aes-key'
    | 'cache:security:cap-token'
    | 'cache:security:rsa-pub-key'
    | 'cache:security:lock'
    | 'risk:device'
    | 'risk:user-device'
    | 'risk:failed-login'
    | 'risk:rate:device'
    | 'risk:challenge:device'
    | 'risk:challenge:user-device'
    | 'murlock:cap'
    | 'murlock:device-ip-change'
    | 'murlock:lock-guard'
    | 'murlock:sign'
    | 'murlock:risk-failed-login'
    | 'murlock:risk-device'
    | 'murlock:risk-user-device'

/**
 * 键形表：`prefix` 逐字对齐服务端拼法，`deviceIndex` 是 split(':') 之后 deviceId 的下标。
 *
 * **顺序有意义**：长前缀必须先于它的前缀（`SYSTEM:DEVICE:COOKIE_RENEW:` 在
 * `SYSTEM:DEVICE:` 之前，`SIGN:AES_KEY` 在 `SIGN:` 之前），否则短的那条会先把键吃掉，
 * 把固定段当成 deviceId（形态判据会拒，但报出来的 family 就错了）。
 */
export const DEVICE_KEY_FAMILIES: readonly { family: DeviceKeyFamily, prefix: string, deviceIndex: number }[] = [
  // ── 应用缓存（AppTechCacheService 统一加 `WALNUT_CACHE_` 前缀）──
  { family: 'cache:system:device-cookie-renew', prefix: 'WALNUT_CACHE_SYSTEM:DEVICE:COOKIE_RENEW:', deviceIndex: 3 },
  { family: 'cache:system:device', prefix: 'WALNUT_CACHE_SYSTEM:DEVICE:', deviceIndex: 2 },
  { family: 'cache:auth:sessions', prefix: 'WALNUT_CACHE_AUTH:SESSIONS:', deviceIndex: 3 },
  { family: 'cache:auth:permissions', prefix: 'WALNUT_CACHE_AUTH:PERMISSIONS:', deviceIndex: 3 },
  { family: 'cache:auth:mfa:verified', prefix: 'WALNUT_CACHE_AUTH:MFA:VERIFIED:', deviceIndex: 4 },
  { family: 'cache:auth:mfa:totp', prefix: 'WALNUT_CACHE_AUTH:MFA:TOTP:', deviceIndex: 4 },
  { family: 'cache:auth:mfa:webauthn', prefix: 'WALNUT_CACHE_AUTH:MFA:WEBAUTN:', deviceIndex: 4 },
  { family: 'cache:auth:opaque-state', prefix: 'WALNUT_CACHE_AUTH:OPAQUE_STATE:', deviceIndex: 3 },
  { family: 'cache:security:sign-ticket', prefix: 'WALNUT_CACHE_SECURITY:SIGN:TICKET:', deviceIndex: 3 },
  { family: 'cache:security:sign-aes-key', prefix: 'WALNUT_CACHE_SECURITY:SIGN:AES_KEY:', deviceIndex: 3 },
  { family: 'cache:security:cap-token', prefix: 'WALNUT_CACHE_SECURITY:CAP_TOKEN:', deviceIndex: 2 },
  { family: 'cache:security:rsa-pub-key', prefix: 'WALNUT_CACHE_SECURITY:RSA:PUB_KEY:', deviceIndex: 3 },
  { family: 'cache:security:lock', prefix: 'WALNUT_CACHE_SECURITY:LOCK:', deviceIndex: 3 },
  // ── 风控（risk 模块直连 Redis，无 WALNUT_CACHE 前缀）──
  { family: 'risk:device', prefix: 'risk:device:', deviceIndex: 2 },
  { family: 'risk:user-device', prefix: 'risk:user_device:', deviceIndex: 3 },
  { family: 'risk:failed-login', prefix: 'risk:failed_login:', deviceIndex: -1 }, // 末段 = deviceId
  // rate 计数：`risk:rate:<ip|device|user>:<identifier>:<minuteKey>`（rate.service 的 buildKey）；
  // 只有 device 那一支带 deviceId，ip / user 两支不会命中这个前缀。
  { family: 'risk:rate:device', prefix: 'risk:rate:device:', deviceIndex: 3 },
  { family: 'risk:challenge:device', prefix: 'risk:challenge:device:', deviceIndex: 3 },
  { family: 'risk:challenge:user-device', prefix: 'risk:challenge:user-device:', deviceIndex: 4 },
  // ── 分布式锁（murlock 直连 Redis；TTL 短，崩溃时仍可能残留）──
  { family: 'murlock:cap', prefix: 'APP:MURLOCK:CAP:', deviceIndex: 3 },
  { family: 'murlock:device-ip-change', prefix: 'APP:MURLOCK:DEVICE:IP_CHANGE:', deviceIndex: 4 },
  { family: 'murlock:lock-guard', prefix: 'APP:MURLOCK:LOCK_GUARD:', deviceIndex: 4 },
  { family: 'murlock:sign', prefix: 'APP:MURLOCK:SIGN:', deviceIndex: 3 },
  { family: 'murlock:risk-failed-login', prefix: 'APP:MURLOCK:RISK:FAILED_LOGIN:', deviceIndex: 4 },
  // 风控评估的请求级锁（security/risk/modules/{device,user_device}.service.ts）：正常路径
  // `runWithLock` 的 finally 会释放，只有崩溃 / 强杀才残留；设备行不在了 ⇒ 精确删。
  { family: 'murlock:risk-device', prefix: 'APP:MURLOCK:RISK:DEVICE:', deviceIndex: 4 },
  { family: 'murlock:risk-user-device', prefix: 'APP:MURLOCK:RISK:USER_DEVICE:', deviceIndex: 5 },
]

/**
 * SCAN 的 MATCH 模式（只扫**可能有设备**的命名空间，永远不扫 `*`）。
 *
 * 这些模式会多带出一些无设备键（`SECURITY:SIGN:NONCE:*`、`risk:challenge:user:*`、
 * `SECURITY:LOCK:<userId>:global`…）；它们由 {@link parseDeviceKey} 判成「没有合法 deviceId」，
 * 只进 skipped 计数，不进删除面。
 */
export const DEVICE_KEY_SCAN_PATTERNS: readonly string[] = [
  'WALNUT_CACHE_SYSTEM:DEVICE:*',
  'WALNUT_CACHE_AUTH:SESSIONS:*',
  'WALNUT_CACHE_AUTH:PERMISSIONS:*',
  'WALNUT_CACHE_AUTH:MFA:*',
  'WALNUT_CACHE_AUTH:OPAQUE_STATE:*',
  'WALNUT_CACHE_SECURITY:SIGN:*',
  'WALNUT_CACHE_SECURITY:CAP_TOKEN:*',
  'WALNUT_CACHE_SECURITY:RSA:*',
  'WALNUT_CACHE_SECURITY:LOCK:*',
  'risk:device:*',
  'risk:user_device:*',
  'risk:failed_login:*',
  'risk:rate:device:*',
  'risk:challenge:*',
  'APP:MURLOCK:*',
]

export interface ParsedDeviceKey {
  key: string
  family: DeviceKeyFamily
  /** 槽位上的设备 id；形态不合法 / 该槽位是 `global` 之类时为 null（只统计，不删） */
  deviceId: string | null
}

/**
 * 解析一个键（纯函数）。不属于设备键族 ⇒ `null`；属于但设备槽位不合法 ⇒ `deviceId: null`。
 */
export function parseDeviceKey(key: string): ParsedDeviceKey | null {
  for (const rule of DEVICE_KEY_FAMILIES) {
    if (!key.startsWith(rule.prefix)) {
      continue
    }
    const parts = key.split(':')
    const index = rule.deviceIndex === -1 ? parts.length - 1 : rule.deviceIndex
    const candidate = parts[index]
    return {
      key,
      family: rule.family,
      deviceId: candidate !== undefined && DEVICE_ID_PATTERN.test(candidate) ? candidate : null,
    }
  }
  return null
}

export interface OrphanKey {
  key: string
  family: DeviceKeyFamily
  deviceId: string
}

export interface RedisGcPlan {
  /** 解析出的设备键（deviceId 合法） */
  deviceKeys: ParsedDeviceKey[]
  /** 设备在 `sys_device` 里存在 ⇒ 保留 */
  kept: ParsedDeviceKey[]
  /** 设备不存在 ⇒ 删除（精确键名） */
  orphans: OrphanKey[]
  /** 属于设备键族但 deviceId 槽位不合法（形态不认识 / 是 `global`）：只报告 */
  skipped: ParsedDeviceKey[]
  /** 不属于任何设备键族（SCAN 的宽模式带出来的） */
  ignored: string[]
}

/**
 * 对账计划（纯函数）：扫描结果 + 现存设备集合 → 保留 / 孤儿 / 跳过。
 *
 * 判据只有一条：**deviceId 合法且不在 `existingDeviceIds` 里**才算孤儿。
 */
export function planRedisGc(keys: readonly string[], existingDeviceIds: ReadonlySet<string>): RedisGcPlan {
  const plan: RedisGcPlan = { deviceKeys: [], kept: [], orphans: [], skipped: [], ignored: [] }

  // 多个 SCAN 模式会重合（`SYSTEM:DEVICE:COOKIE_RENEW:*` 同时命中 `SYSTEM:DEVICE:*`）：
  // 这里按输入去重，删除面与统计都不会把同一个键算两次。
  for (const key of new Set(keys)) {
    const parsed = parseDeviceKey(key)
    if (parsed === null) {
      plan.ignored.push(key)
      continue
    }
    if (parsed.deviceId === null) {
      plan.skipped.push(parsed)
      continue
    }
    plan.deviceKeys.push(parsed)
    if (existingDeviceIds.has(parsed.deviceId)) {
      plan.kept.push(parsed)
    }
    else {
      plan.orphans.push({ key: parsed.key, family: parsed.family, deviceId: parsed.deviceId })
    }
  }

  return plan
}

/** 按长度切块（DEL 一次带太多键会撑爆命令行；SCAN 已完成发现，这里只是分批） */
export function chunkKeys<T>(values: readonly T[], size = 500): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function log(message: string): void {
  console.log(`[e2e/redis-gc] ${message}`)
}

async function scanAll(client: RedisClientType): Promise<string[]> {
  const seen = new Set<string>()
  for (const pattern of DEVICE_KEY_SCAN_PATTERNS) {
    for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 500 })) {
      for (const item of Array.isArray(key) ? key : [key]) {
        seen.add(item)
      }
    }
  }
  return [...seen]
}

async function connectRedis(): Promise<RedisClientType> {
  assertE2eRedisPort(E2E_REDIS_PORT)
  const client = createClient({
    socket: { host: E2E_REDIS_HOST, port: E2E_REDIS_PORT },
    password: E2E_REDIS_PASS,
  })
  client.on('error', error => console.error('[e2e/redis-gc] redis:', error))
  await client.connect()
  return client as RedisClientType
}

async function existingDevices(deviceIds: readonly string[]): Promise<Set<string>> {
  if (deviceIds.length === 0) {
    return new Set()
  }
  const unique = [...new Set(deviceIds)]
  return withPg(async (client) => {
    const { rows } = await client.query<{ device_id: string }>(
      'SELECT device_id FROM sys_device WHERE device_id = ANY($1::text[])',
      [unique],
    )
    return new Set(rows.map(row => row.device_id))
  })
}

export interface RedisGcSummary {
  scannedKeys: number
  deviceKeys: number
  keptKeys: number
  skippedKeys: number
  ignoredKeys: number
  orphanKeys: number
  deletedKeys: number
  orphanDeviceIds: number
  dryRun: boolean
  plan: RedisGcPlan
}

export interface RedisGcOptions {
  /** 只列计划、不删（负对照 / 排障时先看一眼） */
  dryRun?: boolean
  /** 最多打印多少条孤儿键（缺省 100；0 = 不逐条打印） */
  printLimit?: number
}

/**
 * 执行一轮对账。返回摘要供 run.ts / CLI 打印与断言。
 *
 * 注意：**没有任何 flush 调用**；删除只发生在 {@link planRedisGc} 判出的精确键上。
 */
export async function runRedisGc(options: RedisGcOptions = {}): Promise<RedisGcSummary> {
  const dryRun = options.dryRun === true
  const printLimit = options.printLimit ?? 100

  const client = await connectRedis()
  try {
    const keys = await scanAll(client)
    const parsed = keys.map(key => parseDeviceKey(key)).filter((item): item is ParsedDeviceKey => item !== null)
    const candidates = parsed
      .map(item => item.deviceId)
      .filter((id): id is string => id !== null)
    const existing = await existingDevices(candidates)
    const plan = planRedisGc(keys, existing)

    let deletedKeys = 0
    if (!dryRun) {
      for (const chunk of chunkKeys(plan.orphans.map(orphan => orphan.key))) {
        deletedKeys += await client.del(chunk)
      }
    }

    const orphanDeviceIds = new Set(plan.orphans.map(orphan => orphan.deviceId))
    const summary: RedisGcSummary = {
      scannedKeys: keys.length,
      deviceKeys: plan.deviceKeys.length,
      keptKeys: plan.kept.length,
      skippedKeys: plan.skipped.length,
      ignoredKeys: plan.ignored.length,
      orphanKeys: plan.orphans.length,
      deletedKeys,
      orphanDeviceIds: orphanDeviceIds.size,
      dryRun,
      plan,
    }

    log(
      `扫描 ${summary.scannedKeys} 键 → 设备键 ${summary.deviceKeys}（保留 ${summary.keptKeys}，`
      + `孤儿 ${summary.orphanKeys} 键 / ${summary.orphanDeviceIds} 个设备，跳过 ${summary.skippedKeys}，`
      + `非设备键 ${summary.ignoredKeys}）`,
    )
    if (printLimit > 0 && (dryRun || summary.orphanKeys > 0)) {
      for (const orphan of plan.orphans.slice(0, printLimit)) {
        log(`  ${dryRun ? '将删' : '已删'} ${orphan.key}（${orphan.family}）`)
      }
      if (plan.orphans.length > printLimit) {
        log(`  … 还有 ${plan.orphans.length - printLimit} 条未逐条打印`)
      }
    }
    for (const skipped of plan.skipped.slice(0, 20)) {
      log(`  跳过 ${skipped.key}（${skipped.family}：deviceId 槽位不是合法形态）`)
    }
    if (dryRun) {
      log('dry-run：什么都没删')
    }
    else {
      log(`已按精确键删除 ${deletedKeys} 个孤儿键（未使用 FLUSHDB / FLUSHALL）`)
    }
    return summary
  }
  finally {
    await client.quit().catch(() => {})
  }
}

/** 入口：`node scripts/redis-gc.ts [--dry-run]` */
async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const unknown = argv.filter(arg => arg !== '--dry-run')
  if (unknown.length > 0) {
    throw new E2ePreconditionError(`不认识的参数：${unknown.join(' ')}（只接受 --dry-run）`)
  }
  await runRedisGc({ dryRun: argv.includes('--dry-run') })
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[e2e/redis-gc] 失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = error instanceof E2ePreconditionError ? 2 : 1
  })
}

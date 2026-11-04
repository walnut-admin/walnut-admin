import type { ExecutionContext } from '@nestjs/common'
import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminExceptionIPNotAcceptable } from '@walnut-server/exceptions/base/406'
import { SharedIpService } from '@walnut-server/ip'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalnutAdminGuardIP } from '../ip.guard'

/**
 * IP guard 只有三条腿：`@WalnutAdminGuardIpFree()` / 黑名单命中 → **40603** / 放行。
 * 判定全部委托给 `SharedIpService.isIpBlacklisted`（永久名单 = app_setting JSON 数组，
 * 临时名单 = Redis 键 `risk:ip_blacklist:<ip>`），所以本文件用**真实的 service** +
 * 一个遵循 TTL 的 Redis 假实现来跑 guard —— 只 mock service 的话，「临时名单 TTL 到期
 * 自动解除」这条腿无从观测（那正是 service 里 `redis.exists` 的语义）。
 *
 * 时间由一个手动时钟推进（不依赖真实等待）：`addToTemporaryBlacklist` 的 `expire` 落
 * 绝对到期时刻，假 Redis 的 `exists` 在该时刻之后自愈删除 —— 与 Redis 的键过期同语义。
 *
 * 反例（把分支钉死的几条）：
 * - 永久名单命中时**不再查**临时名单（exists 调用次数为 0，短路省一次 Redis）；
 * - 临时黑名单属于 A IP 时，B IP 照样放行（键按 IP 归一化隔离）；
 * - 永久名单 JSON 损坏 ⇒ 放行（service 的 catch 分支是 **fail-open**，不 500、也不误杀）。
 */

const BANNED_IP_PERMANENT = '203.0.113.18'
const BANNED_IP_TEMP = '203.0.113.19'
const PROBE_IP = '203.0.113.20'
/** `ipTempBanTtl` 的现行口径（ip.service.ts:66） */
const TEMP_BAN_TTL_SECONDS = 1800
/**
 * 冻结的墙钟基准（2026-01-01T00:00:00Z）。
 *
 * 临时名单的 `bannedAt` / `expiresAt` 由 service 里的 `AppDayjs()` 生成，而 TTL 语义
 * 要求二者**恰好**相差 1800s。若让它们读真实时钟，两次 `Date.now()` 之间必然有毫秒级
 * 抖动（负载下实测出现过 1800001）—— 于是「TTL 口径」这条断言会随机红。
 * 只 Fake `Date`（`toFake: ['Date']`），promise / 微任务不受影响，时间推进用
 * `vi.setSystemTime`：TTL 判据由此变成确定性等式，不再依赖机器快慢。
 */
const FROZEN_NOW = Date.UTC(2026, 0, 1, 0, 0, 0)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FROZEN_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

interface ITempBanHash {
  ip: string
  reason: string
  permanent: number
  bannedAt: number
  expiresAt: number
}

interface IFakeRedisLog {
  hSet: Array<{ key: string, value: ITempBanHash }>
  expire: Array<{ key: string, seconds: number }>
  exists: string[]
  del: string[]
}

function createFakeRedis(clock: () => number) {
  const hashes = new Map<string, ITempBanHash>()
  const expiresAt = new Map<string, number>()
  const log: IFakeRedisLog = { hSet: [], expire: [], exists: [], del: [] }

  const purge = (key: string) => {
    const at = expiresAt.get(key)
    if (at !== undefined && at <= clock()) {
      hashes.delete(key)
      expiresAt.delete(key)
    }
  }

  return {
    log,
    hashes,
    /** 键当前是否活着（含 TTL 回收判定） */
    has(key: string): boolean {
      purge(key)
      return hashes.has(key)
    },
    keys(): string[] {
      const alive: string[] = []
      for (const key of hashes.keys()) {
        purge(key)
        if (hashes.has(key)) {
          alive.push(key)
        }
      }
      return alive
    },
    client: {
      async hSet(key: string, value: ITempBanHash) {
        log.hSet.push({ key, value })
        purge(key)
        hashes.set(key, value)
        return 1
      },
      async expire(key: string, seconds: number) {
        log.expire.push({ key, seconds })
        expiresAt.set(key, clock() + seconds * 1000)
        return 1
      },
      async del(key: string) {
        log.del.push(key)
        purge(key)
        const existed = hashes.delete(key)
        expiresAt.delete(key)
        return existed ? 1 : 0
      },
      async exists(key: string) {
        log.exists.push(key)
        purge(key)
        return hashes.has(key) ? 1 : 0
      },
    },
  }
}

interface IEnv {
  guard: WalnutAdminGuardIP
  service: SharedIpService
  redis: ReturnType<typeof createFakeRedis>
  getAppSettings: ReturnType<typeof vi.fn>
  /** 推进手动时钟（秒） */
  advance: (seconds: number) => void
}

function createEnv(options: { ipFree?: boolean, permanentBlackList?: string } = {}): IEnv {
  // 假 Redis 的过期判定与 service 的 AppDayjs 读的是同一个（被冻结的）时钟
  const clock = () => Date.now()
  const redis = createFakeRedis(clock)

  const getAppSettings = vi.fn(async () => ({
    [WalnutAdminConstAppSettingKeys.APP_GLOBAL_IP_BLACKLIST]:
      options.permanentBlackList ?? JSON.stringify([BANNED_IP_PERMANENT]),
  }))

  const service = new SharedIpService(
    {} as never, // ConfigService —— isIpBlacklisted 不读配置
    {} as never, // HttpService —— 归属地查询不在这条腿
    { getClient: () => redis.client } as never,
    { getAppSettings } as never,
    {
      findAppSettingByKey: vi.fn(async () => null),
      updateAppSettingByKey: vi.fn(async () => undefined),
    } as never,
  )

  const guard = new WalnutAdminGuardIP(
    { getAllAndOverride: () => options.ipFree ?? false } as never,
    service,
  )

  return {
    guard,
    service,
    redis,
    getAppSettings,
    advance: (seconds: number) => {
      vi.setSystemTime(Date.now() + seconds * 1000)
    },
  }
}

function createContext(realIp: string): ExecutionContext {
  const request = { realIp }

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function ipGuardSpecHandler() {},
    getClass: () => class IpGuardSpecController {},
  } as unknown as ExecutionContext
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error)
}

/** 响应壳里的业务码（40603 …）—— 拒绝路径的可观测值 */
function errCodeOf(error: unknown): unknown {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return (response as { errCode?: unknown } | undefined)?.errCode
}

describe('ip guard：IpFree 与永久名单', () => {
  it('装饰器 IpFree ⇒ 放行，且一次黑名单查询都不发', async () => {
    const env = createEnv({ ipFree: true })
    const isIpBlacklisted = vi.spyOn(env.service, 'isIpBlacklisted')

    await expect(env.guard.canActivate(createContext(BANNED_IP_PERMANENT))).resolves.toBe(true)
    expect(isIpBlacklisted).not.toHaveBeenCalled()
  })

  it('永久名单命中 ⇒ 40603 IPBlocked', async () => {
    const env = createEnv()

    const error = await caught(env.guard.canActivate(createContext(BANNED_IP_PERMANENT)))

    expect(error).toBeInstanceOf(WalnutAdminExceptionIPNotAcceptable)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED)
  })

  it('反例：永久名单命中时不再查临时名单（短路省一次 Redis exists）', async () => {
    const env = createEnv()

    await caught(env.guard.canActivate(createContext(BANNED_IP_PERMANENT)))

    expect(env.redis.log.exists).toHaveLength(0)
  })

  it('永久名单是别的 IP ⇒ 放行', async () => {
    const env = createEnv({ permanentBlackList: JSON.stringify(['198.51.100.9']) })

    await expect(env.guard.canActivate(createContext(PROBE_IP))).resolves.toBe(true)
  })

  it('边界：永久名单 JSON 损坏 ⇒ 放行（service 的 catch 是 fail-open，不是 50003）', async () => {
    const env = createEnv({ permanentBlackList: 'not-json' })

    await expect(env.guard.canActivate(createContext(PROBE_IP))).resolves.toBe(true)
    expect(env.redis.log.exists).toHaveLength(1)
  })
})

describe('ip guard：临时名单（Redis，含 TTL）', () => {
  it('加入临时名单 ⇒ 同一 IP 40603，且落库形态是「permanent:0 + 1800s TTL」', async () => {
    const env = createEnv({ permanentBlackList: '[]' })
    await env.service.addToTemporaryBlacklist(BANNED_IP_TEMP, 'GUARD_SPEC')

    const expectedKey = `risk:ip_blacklist:${BANNED_IP_TEMP}`
    expect(env.redis.log.expire).toEqual([{ key: expectedKey, seconds: TEMP_BAN_TTL_SECONDS }])

    const banned = env.redis.log.hSet[0]
    expect(banned.key).toBe(expectedKey)
    expect(banned.value).toMatchObject({ ip: BANNED_IP_TEMP, reason: 'GUARD_SPEC', permanent: 0 })
    // 假时钟下两次 AppDayjs() 读同一时刻 ⇒ 「TTL 恰好 1800s」是确定性等式（不是差值容差）
    expect(banned.value.bannedAt).toBe(FROZEN_NOW)
    expect(banned.value.expiresAt).toBe(FROZEN_NOW + TEMP_BAN_TTL_SECONDS * 1000)

    const error = await caught(env.guard.canActivate(createContext(BANNED_IP_TEMP)))
    expect(error).toBeInstanceOf(WalnutAdminExceptionIPNotAcceptable)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED)
  })

  it('临时名单到期前 1s ⇒ 仍 40603', async () => {
    const env = createEnv({ permanentBlackList: '[]' })
    await env.service.addToTemporaryBlacklist(BANNED_IP_TEMP)

    env.advance(TEMP_BAN_TTL_SECONDS - 1)

    await expect(env.guard.canActivate(createContext(BANNED_IP_TEMP)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionIPNotAcceptable)
    expect(env.redis.has(`risk:ip_blacklist:${BANNED_IP_TEMP}`)).toBe(true)
  })

  it('临时名单到期 ⇒ 自动解除：同一 IP 放行，且键被 TTL 回收（不是靠 remove 显式删除）', async () => {
    const env = createEnv({ permanentBlackList: '[]' })
    await env.service.addToTemporaryBlacklist(BANNED_IP_TEMP)
    const key = `risk:ip_blacklist:${BANNED_IP_TEMP}`
    expect(env.redis.has(key)).toBe(true)

    env.advance(TEMP_BAN_TTL_SECONDS + 1)

    await expect(env.guard.canActivate(createContext(BANNED_IP_TEMP))).resolves.toBe(true)
    expect(env.redis.has(key)).toBe(false)
    // 放行是「查过 Redis 之后判定未命中」，不是跳过检查
    expect(env.redis.log.exists).toContain(key)
    // 整个用例没有走显式解除通道
    expect(env.redis.log.del).toHaveLength(0)
  })

  it('反例：临时黑名单属于 A IP ⇒ B IP 照样放行（键按 IP 隔离）', async () => {
    const env = createEnv({ permanentBlackList: '[]' })
    await env.service.addToTemporaryBlacklist(BANNED_IP_TEMP)

    await expect(env.guard.canActivate(createContext(PROBE_IP))).resolves.toBe(true)
    await expect(env.guard.canActivate(createContext(BANNED_IP_TEMP)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionIPNotAcceptable)
  })

  it('边界：IPv6 走 normalizeIp 归一（冒号换下划线）后同样命中', async () => {
    const ipv6 = '2001:db8::42'
    const env = createEnv({ permanentBlackList: '[]' })
    await env.service.addToTemporaryBlacklist(ipv6)

    const key = env.redis.log.hSet[0].key
    expect(key).toBe('risk:ip_blacklist:2001_db8__42')

    await expect(env.guard.canActivate(createContext(ipv6)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionIPNotAcceptable)
  })
})

describe('ip guard：两条名单都未命中', () => {
  it('非黑名单 IP ⇒ 放行（临时键查过一次、未命中）', async () => {
    const env = createEnv({ permanentBlackList: '[]' })

    await expect(env.guard.canActivate(createContext(PROBE_IP))).resolves.toBe(true)
    expect(env.redis.log.exists).toEqual([`risk:ip_blacklist:${PROBE_IP}`])
    expect(env.getAppSettings).toHaveBeenCalled()
  })
})

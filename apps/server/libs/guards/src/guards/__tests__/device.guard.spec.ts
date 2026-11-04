import type { ExecutionContext } from '@nestjs/common'
import { AppTechCacheDeviceService, AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys, WalnutAdminConstDeviceCookieMaxAge, WalnutAdminConstDeviceCookieRenewInterval } from '@walnut-server/const/app/cookie'
import { AppTechCookieService } from '@walnut-server/cookie'
import { WalnutAdminExceptionDeviceBanned, WalnutAdminExceptionDeviceLocked, WalnutAdminExceptionDeviceNotAcceptable } from '@walnut-server/exceptions/base/406'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalnutAdminGuardDevice } from '../device.guard'

/**
 * Device guard —— 本文件补的是「一份单测都没有」的四处空白，全部只断言**可观测行为**
 * （返回值 / 抛出的 errCode / Redis 键 / 下发 cookie 的三元组）：
 *
 * 1. `@WalnutAdminGuardDeviceFree()` 短路（端点标了就不取设备）；
 * 2. `isValidDeviceId` 形态判据（B5 硬切：`d1_` + 32 hex 通过，旧 64hex / 空 / 畸形拒绝），
 *    并要求拒绝发生在**碰 DB 与缓存之前**；
 * 3. 缓存 miss ⇒ 回源 `sys_device` ⇒ 回填缓存（P2-2），回填后同一设备不再查库；
 * 4. 滑动续期窗口（`device.guard.ts:53-71`）：窗口空 ⇒ 重发 `DEVICE_ID` cookie，
 *    窗口内 ⇒ 不重发。这是「第 31 天全站 40605、连登录都进不去」那条死锁的后端半边。
 *
 * 时间语义一律用**假时钟**（`toFake: ['Date']` + `vi.setSystemTime`），假 Redis 的 TTL
 * 与 `markDeviceCookieRenewed` 的 `SET NX EX` 读同一个时钟 —— 断言是确定性等式
 * （「续期间隔恰好 N 毫秒」），不是 `Date.now()` 差值或「小于某毫秒」这类墙钟判据。
 *
 * 用真实 `AppTechCacheService` + 真实 `AppTechCacheDeviceService` + 假 Redis 客户端跑，
 * 「NX 只写一次」「TTL 到期窗口重开」这些语义是**被测对象自己**的行为，mock 掉就没得测了。
 */

/** 服务端签发的合法形态：`d1_` + 32 位小写 hex（`libs/const/src/app/device.ts`） */
const VALID_DEVICE_ID = `d1_${'0123456789abcdef'.repeat(2)}`
/** B5 之前的旧形态：64 位小写 hex（实际存在过的客户端 cookie 值） */
const LEGACY_DEVICE_ID = 'b5'.repeat(32)
const OTHER_DEVICE_ID = `d1_${'fedcba9876543210'.repeat(2)}`

const CURRENT_IP = '203.0.113.10'

/** 冻结的假时钟基准（2026-01-01T00:00:00Z）：续期窗口的判定坐标 */
const FROZEN_NOW = Date.UTC(2026, 0, 1, 0, 0, 0)

/** 续期标记在 Redis 里的 TTL（秒）—— 与 `markDeviceCookieRenewed` 同源算法 */
const RENEW_MARKER_TTL_SECONDS = Math.max(1, Math.ceil(WalnutAdminConstDeviceCookieRenewInterval / 1000))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FROZEN_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/** 与 `AppTechCacheService` 同口径的物理键（`WALNUT_CACHE_` 前缀） */
function physicalKey(key: string): string {
  return key.startsWith('WALNUT_CACHE') ? key : `WALNUT_CACHE_${key}`
}

interface IRedisSetOptions {
  NX?: boolean
  EX?: number
}

/**
 * 假 Redis 客户端（只实现 guard 链用到的四条命令 + 真 TTL 语义）。
 *
 * - `set(NX + EX)`：NX 命中已存在的键返回 null（= 没抢到续期窗口），EX 让键在假时钟
 *   走过 TTL 之后自己消失 —— 这正是「窗口重新打开」的来源，不需要被测代码有手动删除通道；
 * - `setEx`：`cacheService.set` 带 ttl 时走这条；
 * - `get` / `del`：读与删。
 */
function createFakeRedis(clock: () => number) {
  const store = new Map<string, { raw: string, expiresAt: number | null }>()
  const log = {
    set: [] as Array<{ key: string, options?: IRedisSetOptions }>,
    setEx: [] as Array<{ key: string, ttl: number }>,
    get: [] as string[],
    del: [] as string[],
  }

  const purge = (key: string) => {
    const entry = store.get(key)
    if (entry !== undefined && entry.expiresAt !== null && entry.expiresAt <= clock()) {
      store.delete(key)
    }
  }

  const client = {
    async get(key: string) {
      log.get.push(key)
      purge(key)
      return store.get(key)?.raw ?? null
    },
    async set(key: string, value: string, options?: IRedisSetOptions) {
      log.set.push({ key, options })
      purge(key)

      if (options?.NX === true && store.has(key)) {
        return null
      }

      store.set(key, {
        raw: value,
        expiresAt: options?.EX === undefined ? null : clock() + options.EX * 1000,
      })

      return 'OK'
    },
    async setEx(key: string, ttl: number, value: string) {
      log.setEx.push({ key, ttl })
      store.set(key, { raw: value, expiresAt: clock() + ttl * 1000 })
      return 'OK'
    },
    async del(key: string) {
      log.del.push(key)
      purge(key)
      const existed = store.delete(key)
      return existed ? 1 : 0
    },
  }

  return {
    log,
    client,
    /** 逻辑键当前是否活着（含 TTL 回收判定） */
    has(key: string): boolean {
      const key2 = physicalKey(key)
      purge(key2)
      return store.has(key2)
    },
    /** 逻辑键剩余寿命（毫秒）；键不存在返回 null */
    ttlMs(key: string): number | null {
      const key2 = physicalKey(key)
      purge(key2)
      const entry = store.get(key2)
      if (entry === undefined || entry.expiresAt === null) {
        return null
      }
      return entry.expiresAt - clock()
    },
  }
}

interface IDeviceState {
  locked: boolean
  banned: boolean
  active: boolean
  currentIp: string
}

interface IGuardEnvOptions {
  /** `@WalnutAdminGuardDeviceFree()` 是否生效 */
  deviceFree?: boolean
  /** 请求 cookie 里的 DEVICE_ID（`undefined` = 没种这个 cookie） */
  cookieDeviceId?: string
  /** 库里那一行（`null` = 库里没有这行，模拟 90 天 purge 之后） */
  deviceRow?: { locked: boolean, banned: boolean, active: boolean, ip: string | null } | null
  /** 缓存里已有状态（`undefined` = 缓存 miss） */
  cached?: IDeviceState
  realIp?: string
  isPostman?: boolean
}

interface IGuardEnv {
  guard: WalnutAdminGuardDevice
  cacheDeviceService: AppTechCacheDeviceService
  cookie: ReturnType<typeof vi.fn>
  deviceRepo: {
    findDeviceByDeviceId: ReturnType<typeof vi.fn>
    updateIpAndLocation: ReturnType<typeof vi.fn>
  }
  redis: ReturnType<typeof createFakeRedis>
  request: Record<string, unknown>
  context: ExecutionContext
  /** 推进假时钟（毫秒） */
  advance: (ms: number) => void
}

async function createEnv(options: IGuardEnvOptions = {}): Promise<IGuardEnv> {
  const redis = createFakeRedis(() => Date.now())
  const cacheService = new AppTechCacheService(
    { getClient: () => redis.client } as never,
  )
  const cacheDeviceService = new AppTechCacheDeviceService(cacheService)

  const deviceRow = options.deviceRow === undefined
    ? { locked: false, banned: false, active: true, ip: CURRENT_IP }
    : options.deviceRow

  const deviceRepo = {
    findDeviceByDeviceId: vi.fn(async () => deviceRow === null
      ? null
      : { ...deviceRow, deviceId: options.cookieDeviceId ?? VALID_DEVICE_ID }),
    updateIpAndLocation: vi.fn(async () => true),
  }

  const cookie = vi.fn()
  const request: Record<string, unknown> = {
    signedCookies: options.cookieDeviceId === undefined
      ? {}
      : { [WalnutAdminConstCookieKeys.DEVICE_ID]: options.cookieDeviceId },
    realIp: options.realIp ?? CURRENT_IP,
    isPostman: options.isPostman ?? false,
    res: { cookie },
  }

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function deviceGuardSpecHandler() {},
    getClass: () => class DeviceGuardSpecController {},
  } as unknown as ExecutionContext

  const guard = new WalnutAdminGuardDevice(
    { getAllAndOverride: () => options.deviceFree ?? false } as never,
    cacheDeviceService,
    deviceRepo as never,
    { runWithLock: async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn() } as never,
    new AppTechCookieService(),
  )

  if (options.cached !== undefined) {
    // 直接写到假 Redis：走的是生产的 cacheService.set（键前缀 / 包装 / 读回语义都一致）
    await cacheService.set(
      `${WalnutAdminConstAppCacheKeys.SYS_DEVICE}:${options.cookieDeviceId ?? VALID_DEVICE_ID}`,
      options.cached,
      { t: WalnutAdminConstAppCacheType.SYSTEM },
    )
  }

  // fixture 自己的写入不留痕：下面每条断言读到的都是**守卫这次请求**发的 Redis 命令
  redis.log.set.length = 0
  redis.log.setEx.length = 0
  redis.log.get.length = 0
  redis.log.del.length = 0

  return {
    guard,
    cacheDeviceService,
    cookie,
    deviceRepo,
    redis,
    request,
    context,
    advance: (ms: number) => {
      vi.setSystemTime(Date.now() + ms)
    },
  }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error)
}

/** 响应壳里的业务码（40605 / 40606 / 40607）—— 拒绝路径的可观测值 */
function errCodeOf(error: unknown): unknown {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return (response as { errCode?: unknown } | undefined)?.errCode
}

/** 续期时间闸的逻辑键（与 `AppTechCacheDeviceService.markDeviceCookieRenewed` 同口径） */
function renewMarkerKey(deviceId: string) {
  return `${WalnutAdminConstAppCacheKeys.SYS_DEVICE_COOKIE_RENEW}:${deviceId}`
}

describe('device guard：@WalnutAdminGuardDeviceFree 短路', () => {
  it('装饰器标了 DeviceFree ⇒ 放行，且不读 cookie / 不查缓存 / 不查库 / 不下发 cookie', async () => {
    const env = await createEnv({ deviceFree: true, cookieDeviceId: undefined })

    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)

    // 连 cookie 都没读：装饰器短路在 canActivate 的第一步
    expect(env.redis.log.get).toHaveLength(0)
    expect(env.deviceRepo.findDeviceByDeviceId).not.toHaveBeenCalled()
    expect(env.cookie).not.toHaveBeenCalled()
  })

  it('对照：同一请求不标 DeviceFree ⇒ 真的去取设备（同一枚缺 cookie 的请求变 40605）', async () => {
    const env = await createEnv({ deviceFree: false, cookieDeviceId: undefined })

    const error = await caught(env.guard.canActivate(env.context))

    // 与上一条只差一个装饰器标记 —— 证明放行来自标记，不是别的原因碰巧放过了
    expect(error).toBeInstanceOf(WalnutAdminExceptionDeviceNotAcceptable)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)
  })
})

describe('device guard：isValidDeviceId 形态判据（B5 硬切，只在这一处判）', () => {
  it('d1_ + 32 位小写 hex ⇒ 通过', async () => {
    const env = await createEnv({ cookieDeviceId: VALID_DEVICE_ID, cached: { locked: false, banned: false, active: true, currentIp: CURRENT_IP } })

    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)
  })

  it('旧形态 64 位 hex ⇒ 40605，且在碰缓存与 DB **之前**就拒掉', async () => {
    const env = await createEnv({ cookieDeviceId: LEGACY_DEVICE_ID })

    const error = await caught(env.guard.canActivate(env.context))

    expect(error).toBeInstanceOf(WalnutAdminExceptionDeviceNotAcceptable)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)
    // 形态判据是链路第一步：不进缓存、不回源，也就不会为旧值查出一行「幽灵设备」
    expect(env.redis.log.get).toHaveLength(0)
    expect(env.deviceRepo.findDeviceByDeviceId).not.toHaveBeenCalled()
  })

  it('cookie 缺失 / 空串 ⇒ 40605（两种情况同一条判据）', async () => {
    for (const cookieDeviceId of [undefined, '']) {
      const env = await createEnv({ cookieDeviceId })
      const error = await caught(env.guard.canActivate(env.context))

      expect(error, `cookie=${JSON.stringify(cookieDeviceId)}`).toBeInstanceOf(WalnutAdminExceptionDeviceNotAcceptable)
      expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)
      expect(env.redis.log.get).toHaveLength(0)
    }
  })

  it('畸形值一律 40605：长度不对 / 大写 hex / 错前缀 / 非 hex 字符', async () => {
    const malformed = [
      `d1_${'0123456789abcdef'.repeat(2).toUpperCase()}`, // 大写 hex（形态要求小写）
      `d1_${'0123456789abcdef'.repeat(2).slice(0, 31)}`, // 少一位
      `d1_${'0123456789abcdef'.repeat(2)}0`, // 多一位
      `d2_${'0123456789abcdef'.repeat(2)}`, // 错前缀
      `d1_${'0123456789abcde'.padEnd(32, 'g')}`, // 非 hex 字符
      ` ${VALID_DEVICE_ID}`, // 前导空格
      VALID_DEVICE_ID.replace('d1_', ''), // 缺前缀
    ]

    for (const cookieDeviceId of malformed) {
      const env = await createEnv({ cookieDeviceId })
      const error = await caught(env.guard.canActivate(env.context))

      expect(error, `应判非法: ${JSON.stringify(cookieDeviceId)}`).toBeInstanceOf(WalnutAdminExceptionDeviceNotAcceptable)
      expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)
    }
  })
})

describe('device guard：缓存 miss ⇒ 回源库 ⇒ 回填缓存（P2-2）', () => {
  it('缓存 miss ⇒ 查库一次 ⇒ 回填缓存（同一设备下一次请求只读缓存，不再查库）', async () => {
    const env = await createEnv({
      cookieDeviceId: VALID_DEVICE_ID,
      deviceRow: { locked: false, banned: false, active: true, ip: CURRENT_IP },
    })

    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)
    expect(env.deviceRepo.findDeviceByDeviceId).toHaveBeenCalledTimes(1)
    expect(env.deviceRepo.findDeviceByDeviceId).toHaveBeenCalledWith(VALID_DEVICE_ID)

    // 回填的就是库里那一行的四个判定字段（`ip` → `currentIp` 的映射也是这里定的）
    expect(await env.cacheDeviceService.getSysDeviceCache(VALID_DEVICE_ID))
      .toEqual({ locked: false, banned: false, active: true, currentIp: CURRENT_IP })

    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)
    expect(env.deviceRepo.findDeviceByDeviceId).toHaveBeenCalledTimes(1)
  })

  it('缓存命中 ⇒ 不查库（回源只在 miss 时发生）', async () => {
    const env = await createEnv({
      cookieDeviceId: VALID_DEVICE_ID,
      cached: { locked: false, banned: false, active: true, currentIp: CURRENT_IP },
    })

    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)
    expect(env.deviceRepo.findDeviceByDeviceId).not.toHaveBeenCalled()
  })

  it('缓存 miss + 库里没有这行 ⇒ 40605（90 天 purge 撞上「浏览器 cookie 还在」的真实用户态）', async () => {
    const env = await createEnv({ cookieDeviceId: VALID_DEVICE_ID, deviceRow: null })

    const error = await caught(env.guard.canActivate(env.context))

    expect(error).toBeInstanceOf(WalnutAdminExceptionDeviceNotAcceptable)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)
    // 查不到就不回填：缓存里仍是 miss（不放行、也不留空壳）
    expect(await env.cacheDeviceService.getSysDeviceCache(VALID_DEVICE_ID)).toBeNull()
  })

  it('回源后仍走同一条拒绝链：库里 locked=true ⇒ 40606（不是「缓存清了就放行」）', async () => {
    const env = await createEnv({
      cookieDeviceId: VALID_DEVICE_ID,
      deviceRow: { locked: true, banned: false, active: true, ip: CURRENT_IP },
    })

    const error = await caught(env.guard.canActivate(env.context))

    expect(error).toBeInstanceOf(WalnutAdminExceptionDeviceLocked)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_LOCKED)
  })
})

describe('device guard：DEVICE_ID cookie 滑动续期窗口（P0-1）', () => {
  const cachedDevice: IDeviceState = { locked: false, banned: false, active: true, currentIp: CURRENT_IP }

  it('窗口空（无续期标记）⇒ 重发 DEVICE_ID cookie（maxAge 拉满），并写续期标记（TTL = 续期间隔）', async () => {
    const env = await createEnv({ cookieDeviceId: VALID_DEVICE_ID, cached: cachedDevice })

    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)

    // 三要素：键 / 值 / maxAge —— 与 /system/device/initial 下发的那一枚同源（同一 const）
    expect(env.cookie).toHaveBeenCalledTimes(1)
    const [key, value, options] = env.cookie.mock.calls[0] as [string, string, { maxAge?: number }]
    expect(key).toBe(WalnutAdminConstCookieKeys.DEVICE_ID)
    expect(value).toBe(VALID_DEVICE_ID)
    expect(options.maxAge).toBe(WalnutAdminConstDeviceCookieMaxAge)

    // 时间闸：SET NX EX（单命令），TTL 恰好是续期间隔 —— 假时钟下是等式，不是容差
    expect(env.redis.log.set).toEqual([
      expect.objectContaining({
        key: physicalKey(renewMarkerKey(VALID_DEVICE_ID)),
        options: { NX: true, EX: RENEW_MARKER_TTL_SECONDS },
      }),
    ])
    expect(env.redis.ttlMs(renewMarkerKey(VALID_DEVICE_ID))).toBe(WalnutAdminConstDeviceCookieRenewInterval)
  })

  it('窗口内（紧接着第二次请求）⇒ 不再重发：标记已占位，cookie 只下发过一次', async () => {
    const env = await createEnv({ cookieDeviceId: VALID_DEVICE_ID, cached: cachedDevice })

    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)
    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)

    expect(env.cookie).toHaveBeenCalledTimes(1)
    // 两次都尝试抢窗口（SET NX），第二次没抢到 —— 不是「跳过了续期逻辑」
    expect(env.redis.log.set).toHaveLength(2)
  })

  it('窗口边界：差 1ms 未到期 ⇒ 不重发；到期 ⇒ 再发一次（滑动而非一次性）', async () => {
    const env = await createEnv({ cookieDeviceId: VALID_DEVICE_ID, cached: cachedDevice })

    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)
    expect(env.cookie).toHaveBeenCalledTimes(1)

    // 窗口未到期：剩余 1ms 仍然算「刚续过」
    env.advance(WalnutAdminConstDeviceCookieRenewInterval - 1)
    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)
    expect(env.cookie).toHaveBeenCalledTimes(1)

    // 到期：标记被 TTL 回收 ⇒ 重发，并且重新占位（cookie 剩余寿命因此恒 > 20%）
    env.advance(1)
    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)
    expect(env.cookie).toHaveBeenCalledTimes(2)
    expect(env.redis.ttlMs(renewMarkerKey(VALID_DEVICE_ID))).toBe(WalnutAdminConstDeviceCookieRenewInterval)
  })

  it('反例：封禁 / 锁定的设备窗口空也不发新 cookie（续期只在校验全通过之后）', async () => {
    for (const [cached, exception] of [
      [{ locked: false, banned: true, active: true, currentIp: CURRENT_IP }, WalnutAdminExceptionDeviceBanned],
      [{ locked: true, banned: false, active: true, currentIp: CURRENT_IP }, WalnutAdminExceptionDeviceLocked],
    ] as const) {
      const env = await createEnv({ cookieDeviceId: VALID_DEVICE_ID, cached })

      const error = await caught(env.guard.canActivate(env.context))

      expect(error).toBeInstanceOf(exception)
      // 被拒的设备拿不到续命 cookie —— 也不是「先发 cookie 再拒」
      expect(env.cookie).not.toHaveBeenCalled()
      // 续期时间闸根本没被碰（拒绝发生在 renewDeviceCookieIfNeeded 之前）
      expect(env.redis.log.set).toHaveLength(0)
    }
  })

  it('回源路径同样续期：缓存 miss ⇒ 查库回填 ⇒ 窗口空 ⇒ 重发（两条腿都接上了）', async () => {
    const env = await createEnv({
      cookieDeviceId: OTHER_DEVICE_ID,
      deviceRow: { locked: false, banned: false, active: true, ip: CURRENT_IP },
    })

    await expect(env.guard.canActivate(env.context)).resolves.toBe(true)

    expect(env.deviceRepo.findDeviceByDeviceId).toHaveBeenCalledTimes(1)
    expect(env.cookie).toHaveBeenCalledTimes(1)
    const [, value] = env.cookie.mock.calls[0] as [string, string]
    expect(value).toBe(OTHER_DEVICE_ID)
  })
})

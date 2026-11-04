import type { ExecutionContext } from '@nestjs/common'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheType, WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import {
  WalnutAdminExceptionBlackListPathDetected,
  WalnutAdminExceptionBotDetected,
  WalnutAdminExceptionSuspiciousRequest,
  WalnutAdminExceptionUserAgentBrowserNotAcceptable,
  WalnutAdminExceptionUserAgentNotAcceptable,
  WalnutAdminExceptionUserAgentOSNotAcceptable,
} from '@walnut-server/exceptions/base/406'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { describe, expect, it, vi } from 'vitest'
import { WALNUT_ADMIN_PERMANENT_BLACKLIST_PATHS, WalnutAdminGuardSecurity } from '../security.guard'

/**
 * Security guard 的六条腿（`security.guard.ts` 50–105）与它们的**顺序**：
 *
 * | 输入 | 出口 |
 * |------|------|
 * | `isPostman`（研发噪声，非安全边界） | 放行，白名单都不读 |
 * | 无 `userAgent` | 40604 |
 * | `stripApiPrefix(path)` 命中永久黑名单 | 40610 + **把 realIp 写进永久黑名单**（副作用） |
 * | `isBot` | 40608 |
 * | `isSuspicious` | 40609 |
 * | OS 不在白名单（含缺失） | 40601 |
 * | 浏览器不在白名单（含缺失） | 40602 |
 *
 * 白名单这一对腿用**真实的** `AppTechCacheAppSettingsService` + 内存假缓存来跑：
 * 它带进程内 memo（`appSettingsMemo` / `settingMemo`），而 guard **每个请求都重新读**
 * 白名单 —— 「白名单轮换后立刻生效」正是 memo 被写路径失效（`setAppSettings` →
 * `invalidateAppSettingsMemo`）这条真实行为的可观测面。若 guard 自己缓存了白名单，
 * 轮换用例会红。
 *
 * 反例（钉顺序 / 钉判据的那几条）：
 * - `isBot && isSuspicious` ⇒ 40608（bot 先判），黑名单路径 + bot ⇒ **40610**（路径最前）；
 * - `whiteList: []` ⇒ 40601（空名单不是「全放行」）；
 * - 白名单条目大小写/空白归一后做**子串**匹配（`'  mac os  '` 命中 `Mac OS X`）。
 */

const API_PREFIX = 'w'
const API_VERSION = '1'
const BLACKLIST_PROBE_PATH = '/w/v1/wp-admin/setup.php'
const SAFE_PROBE_PATH = '/w/v1/system/user/preference/read'
const PROBE_IP = '203.0.113.31'

interface IWhitelists {
  os?: string[]
  browser?: string[]
}

function createFakeCacheService() {
  const store = new Map<string, unknown>()

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
  }
}

interface IEnv {
  guard: WalnutAdminGuardSecurity
  settings: AppTechCacheAppSettingsService
  cache: ReturnType<typeof createFakeCacheService>
  addToPermanentBlackList: ReturnType<typeof vi.fn>
  /** 走真实写路径轮换白名单（`setAppSettings` 是 memo 失效的唯一入口） */
  rotateWhitelists: (next: IWhitelists) => Promise<void>
}

async function createEnv(whitelists: IWhitelists = {}): Promise<IEnv> {
  const cache = createFakeCacheService()
  const settings = new AppTechCacheAppSettingsService(cache as never)
  const addToPermanentBlackList = vi.fn(async () => undefined)

  const configService = {
    get: (key: string) => (key === 'app.api.prefix' ? API_PREFIX : API_VERSION),
  }

  const guard = new WalnutAdminGuardSecurity(
    settings,
    { addToPermanentBlackList } as never,
    configService as never,
  )

  const rotateWhitelists = async (next: IWhitelists) => {
    await settings.setAppSettings({
      [WalnutAdminConstAppSettingKeys.APP_GLOBAL_OS_WHITELIST]: JSON.stringify(next.os ?? ['Mac OS']),
      [WalnutAdminConstAppSettingKeys.APP_GLOBAL_BROWSER_WHITELIST]: JSON.stringify(next.browser ?? ['Chrome']),
    }, { t: WalnutAdminConstAppCacheType.SYSTEM })
  }

  await rotateWhitelists(whitelists)

  return { guard, settings, cache, addToPermanentBlackList, rotateWhitelists }
}

interface IRequestOptions {
  path?: string
  realIp?: string
  isPostman?: boolean
  isBot?: boolean
  isSuspicious?: boolean
  userAgent?: unknown
}

/** 默认可放行请求：安全路径 + 白名单内的 OS/浏览器 */
const SAFE_REQUEST: IRequestOptions = {
  path: SAFE_PROBE_PATH,
  realIp: PROBE_IP,
  isPostman: false,
  isBot: false,
  isSuspicious: false,
  userAgent: {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0',
    os: { name: 'Mac OS' },
    browser: { name: 'Chrome' },
  },
}

function createContext(overrides: IRequestOptions = {}): ExecutionContext {
  const request = { ...SAFE_REQUEST, ...overrides }

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function securityGuardSpecHandler() {},
    getClass: () => class SecurityGuardSpecController {},
  } as unknown as ExecutionContext
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error)
}

function errCodeOf(error: unknown): unknown {
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return (response as { errCode?: unknown } | undefined)?.errCode
}

describe('security guard：postman 噪声过滤与缺 UA', () => {
  it('isPostman ⇒ 放行，且白名单一次都不读（研发通道不参与策略）', async () => {
    const env = await createEnv()
    const getOSWhiteList = vi.spyOn(env.settings, 'getOSWhiteList')

    await expect(env.guard.canActivate(createContext({ isPostman: true }))).resolves.toBe(true)
    expect(getOSWhiteList).not.toHaveBeenCalled()
  })

  it('反例：isPostman + 无 UA + bot + suspicious + 黑名单路径 ⇒ 仍放行（且不写永久黑名单）', async () => {
    const env = await createEnv()

    await expect(env.guard.canActivate(createContext({
      isPostman: true,
      userAgent: undefined,
      isBot: true,
      isSuspicious: true,
      path: BLACKLIST_PROBE_PATH,
    }))).resolves.toBe(true)

    expect(env.addToPermanentBlackList).not.toHaveBeenCalled()
  })

  it('无 userAgent ⇒ 40604 UserAgentNotAcceptable', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({ userAgent: undefined })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionUserAgentNotAcceptable)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_USER_AGENT_UNSUPPORTED)
  })

  it('边界：UA 存在但 os/browser 都缺 ⇒ 40601（不是 40604 —— 缺的是名单项，不是 UA）', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({ userAgent: { ua: 'curl/8.9.1' } })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionUserAgentOSNotAcceptable)
    expect(error).not.toBeInstanceOf(WalnutAdminExceptionUserAgentNotAcceptable)
  })
})

describe('security guard：永久黑名单路径（含写黑名单副作用）', () => {
  it('带 API 前缀的扫描路径 ⇒ 40610，且把 realIp 写进永久黑名单', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({ path: BLACKLIST_PROBE_PATH })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionBlackListPathDetected)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BLACK_LIST_PATH_DETECTED)
    expect(env.addToPermanentBlackList).toHaveBeenCalledWith(PROBE_IP)
    expect(env.addToPermanentBlackList).toHaveBeenCalledTimes(1)
  })

  it('边界：大小写不敏感（P1-11 之后按 stripApiPrefix 后的路径小写比对）', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({ path: '/w/v1/WP-LOGIN' })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionBlackListPathDetected)
  })

  it('边界：无版本前缀的裸扫描路径同样命中（stripApiPrefix 无匹配时原样返回）', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({ path: '/phpmyadmin/index.php' })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionBlackListPathDetected)
  })

  it('反例：前缀被正确剥离后不是黑名单 ⇒ 放行（不会把 /w/v1/system/menu 当 /admin）', async () => {
    const env = await createEnv()

    await expect(env.guard.canActivate(createContext({ path: '/w/v1/system/menu/tree' }))).resolves.toBe(true)
    expect(env.addToPermanentBlackList).not.toHaveBeenCalled()
  })

  it('顺序：黑名单路径 + bot ⇒ 40610（路径检查在 bot 之前）', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({ path: BLACKLIST_PROBE_PATH, isBot: true })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionBlackListPathDetected)
  })
})

describe('security guard：bot / suspicious', () => {
  it('isBot ⇒ 40608 BotDetected', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({ isBot: true })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionBotDetected)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BOT_DETECTED)
  })

  it('isSuspicious ⇒ 40609 SuspiciousRequest', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({ isSuspicious: true })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionSuspiciousRequest)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_SUSPICIOUS_REQUEST)
  })

  it('反例：isBot && isSuspicious ⇒ 40608（bot 先判，不落成 40609）', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({ isBot: true, isSuspicious: true })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionBotDetected)
    expect(error).not.toBeInstanceOf(WalnutAdminExceptionSuspiciousRequest)
  })
})

describe('security guard：OS 白名单收紧', () => {
  it('白名单不含当前 OS ⇒ 40601', async () => {
    const env = await createEnv({ os: ['Windows'] })

    const error = await caught(env.guard.canActivate(createContext()))

    expect(error).toBeInstanceOf(WalnutAdminExceptionUserAgentOSNotAcceptable)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_OS_UNSUPPORTED)
  })

  it('反例：白名单是空数组 ⇒ 40601（空名单不是全放行）', async () => {
    const env = await createEnv({ os: [] })

    const error = await caught(env.guard.canActivate(createContext()))

    expect(error).toBeInstanceOf(WalnutAdminExceptionUserAgentOSNotAcceptable)
  })

  it('边界：条目大小写/空白归一后子串匹配（\'  mac os  \' 命中 Mac OS X）', async () => {
    const env = await createEnv({ os: ['  mac os  '] })

    await expect(env.guard.canActivate(createContext({
      userAgent: { ua: 'Mozilla/5.0', os: { name: 'Mac OS X' }, browser: { name: 'Chrome' } },
    }))).resolves.toBe(true)
  })

  it('边界：os.name 缺失 ⇒ 40601（isNil ⇒ 不在名单）', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({
      userAgent: { ua: 'Mozilla/5.0', browser: { name: 'Chrome' } },
    })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionUserAgentOSNotAcceptable)
  })
})

describe('security guard：浏览器白名单收紧', () => {
  it('白名单：OS 通过但浏览器不在 ⇒ 40602', async () => {
    const env = await createEnv({ browser: ['Firefox'] })

    const error = await caught(env.guard.canActivate(createContext()))

    expect(error).toBeInstanceOf(WalnutAdminExceptionUserAgentBrowserNotAcceptable)
    expect(errCodeOf(error)).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BROWSER_UNSUPPORTED)
    expect(error).not.toBeInstanceOf(WalnutAdminExceptionUserAgentOSNotAcceptable)
  })

  it('边界：browser.name 缺失 ⇒ 40602（OS 腿已过）', async () => {
    const env = await createEnv()

    const error = await caught(env.guard.canActivate(createContext({
      userAgent: { ua: 'Mozilla/5.0', os: { name: 'Mac OS' } },
    })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionUserAgentBrowserNotAcceptable)
  })
})

describe('security guard：白名单轮换后立即生效（进程内 memo 被写路径失效）', () => {
  it('白名单轮换（OS 收紧）：放行 → 换成不含当前 OS 的名单 ⇒ 同一请求 40601 → 换回 ⇒ 放行', async () => {
    const env = await createEnv({ os: ['Mac OS'], browser: ['Chrome'] })
    const context = createContext()

    await expect(env.guard.canActivate(context)).resolves.toBe(true)

    await env.rotateWhitelists({ os: ['Windows'], browser: ['Chrome'] })
    const tightened = await caught(env.guard.canActivate(context))
    expect(tightened).toBeInstanceOf(WalnutAdminExceptionUserAgentOSNotAcceptable)

    await env.rotateWhitelists({ os: ['Mac OS'], browser: ['Chrome'] })
    await expect(env.guard.canActivate(context)).resolves.toBe(true)
  })

  it('浏览器收紧：OS 仍命中 ⇒ 轮换掉 Chrome 后 40602（两条腿各自读各自的白名单）', async () => {
    const env = await createEnv({ os: ['Mac OS'], browser: ['Chrome'] })
    const context = createContext()

    await expect(env.guard.canActivate(context)).resolves.toBe(true)

    await env.rotateWhitelists({ os: ['Mac OS'], browser: ['Firefox'] })
    const error = await caught(env.guard.canActivate(context))

    expect(error).toBeInstanceOf(WalnutAdminExceptionUserAgentBrowserNotAcceptable)
    expect(error).not.toBeInstanceOf(WalnutAdminExceptionUserAgentOSNotAcceptable)
  })

  it('每个请求都重新读白名单（第 4 次调用同样会读，不是只在首请求读一次）', async () => {
    const env = await createEnv({ os: ['Mac OS'], browser: ['Chrome'] })
    const getOSWhiteList = vi.spyOn(env.settings, 'getOSWhiteList')
    const getBrowserWhiteList = vi.spyOn(env.settings, 'getBrowserWhiteList')

    for (let i = 0; i < 4; i++) {
      await env.guard.canActivate(createContext())
    }

    expect(getOSWhiteList).toHaveBeenCalledTimes(4)
    expect(getBrowserWhiteList).toHaveBeenCalledTimes(4)
  })
})

describe('security guard：黑名单清单自身的边界', () => {
  it('清单是非空只读常量，且匹配是 startsWith（/administrator 也算 /admin 前缀命中）', async () => {
    expect(WALNUT_ADMIN_PERMANENT_BLACKLIST_PATHS.length).toBeGreaterThan(0)

    const env = await createEnv()
    const error = await caught(env.guard.canActivate(createContext({ path: '/w/v1/administrator/login' })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionBlackListPathDetected)
  })
})

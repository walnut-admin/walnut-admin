import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { describe, expect, it, vi } from 'vitest'

import { AppCapJS, SecurityCapService } from './cap.service'

/**
 * CAP `ttl` 单位统一（review CAP-1）的**消费侧**钉子。
 *
 * 修复前：`expiresMs: config.ttl`（把秒当毫秒）⇒ 种子 `ttl=3600` 部署下 challenge **3.6 秒**过期；
 * `maxAge: config.ttl * 1000` 本身凑巧对，但它和 challenge 用的是**两个不同单位理解**，
 * 只要有人「统一」成另一侧就一起崩。
 *
 * 下面每条都断言「等于正确值」并显式 `not.toBe(旧写法算出来的值)` —— 把
 * `cap.service.ts` 任一行改回旧写法，对应用例立刻红（实测见 reports/review-cap/fix-p1.md）。
 */

/** `apps/server/db/seed/app_setting.json:46` 的 cap ttl（秒） */
const SEED_TTL_SECONDS = 3600
const SEED_TTL_MS = SEED_TTL_SECONDS * 1000

const SEED_CONFIG = {
  count: 10,
  size: 16,
  difficulty: 4,
  ttl: SEED_TTL_SECONDS,
  throttleLimit: 4,
  throttleTtl: 60,
}

interface ICookieCall {
  key: string
  value: string
  options: { maxAge: number }
}

function createService(config = SEED_CONFIG) {
  const cookieCalls: ICookieCall[] = []

  const cacheAppSettingsService = {
    getCapJSConfig: vi.fn(async () => config),
  }

  const cookieService = {
    setResponseCookie: vi.fn((_req: unknown, cookies: ICookieCall[]) => {
      cookieCalls.push(...cookies)
    }),
  }

  const service = new SecurityCapService(
    cacheAppSettingsService as unknown as ConstructorParameters<typeof SecurityCapService>[0],
    cookieService as unknown as ConstructorParameters<typeof SecurityCapService>[1],
  )

  return { service, cookieCalls }
}

describe('cap.service：ttl 按「秒」进、按 cap.js / Express 要的单位出', () => {
  it('challenge：ttl=3600 秒 ⇒ expiresMs = 3600000（≈60 分钟），不是 3600（=3.6 秒）', async () => {
    const { service } = createService()
    const createChallengeSpy = vi
      .spyOn(AppCapJS, 'createChallenge')
      .mockResolvedValue({ challenge: {}, token: 'seed-token', expires: 0 } as never)

    await service.challenge()

    // `expiresMs` 在 cap.js 的类型里是可选字段：用 ?? -1 把它拉成确定的数字，
    // 这样"没传"和"传错"都会在同一条断言里红，而不是靠非空断言糊过去
    const [challengeCall] = createChallengeSpy.mock.calls
    const expiresMs = challengeCall?.[0]?.expiresMs ?? -1

    expect(expiresMs).toBe(SEED_TTL_MS)
    expect(expiresMs / 1000 / 60).toBe(60) // 手算：60 分钟
    // 旧写法 `expiresMs: config.ttl` ⇒ 3600（3.6 秒）。改回去这一行必红。
    expect(expiresMs).not.toBe(SEED_TTL_SECONDS)

    createChallengeSpy.mockRestore()
  })

  it('redeem：cookie maxAge = 3600000 ms（≈60 分钟），与 challenge 的有效期同一换算', async () => {
    const { service, cookieCalls } = createService()
    const redeemSpy = vi
      .spyOn(AppCapJS, 'redeemChallenge')
      .mockResolvedValue({ success: true, token: 'deadbeef:cafebabe' })

    await service.redeem({} as never, {} as never)

    expect(cookieCalls).toHaveLength(1)
    expect(cookieCalls[0].key).toBe(WalnutAdminConstCookieKeys.CAPJS_TOKEN)
    expect(cookieCalls[0].value).toBe('deadbeef:cafebabe')
    expect(cookieCalls[0].options.maxAge).toBe(SEED_TTL_MS)
    expect(cookieCalls[0].options.maxAge / 1000 / 60).toBe(60)
    // 旧写法若把 ttl 当毫秒再乘 1000 ⇒ 3.6e9 ms（415 天）。改回去这一行必红。
    expect(cookieCalls[0].options.maxAge).not.toBe(SEED_TTL_SECONDS * 1000 * 1000)

    redeemSpy.mockRestore()
  })

  it('启动日志声明单实例前提（cap.js token 存本地文件，多副本必失败）', () => {
    const { service } = createService()
    const logger = (service as unknown as { logger: { warn: (msg: string) => void } }).logger
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    service.onModuleInit()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = warnSpy.mock.calls[0][0]
    expect(message).toContain('.data/tokensList.json')
    expect(message).toContain('SINGLE instance')

    warnSpy.mockRestore()
  })
})

import type { ExecutionContext } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import {
  WalnutAdminExceptionCapInteractionRequired,
  WalnutAdminExceptionCapRefreshRequired,
  WalnutAdminExceptionYouAreBot,
} from '@walnut-server/exceptions/business/auth'
import { describe, expect, it, vi } from 'vitest'
import { AppCapJS } from '@/modules/security/cap/cap.service'
import { WalnutAdminGuardCap } from './cap.guard'

/**
 * G9（guard 分支覆盖补齐批）：CAP 真验失败（cap.js `validateToken` → success=false）
 * 在 `shouldChallenge` 两态下的出口 —— 40416 / 40117。
 *
 * 为什么走单测：审计建议（HTTP 级不可达）—— 真验失败需要「cookie 有效签名但 token
 * 在 cap.js store 中已消费/不存在」的精确缓存态，而 HTTP 用例要先把一次性 token 耗掉
 * 再清 guard 缓存，时序脆弱；单测直接钉 `performCapVerification` 的 false 出口。
 *
 * 同时钉 P3-31 的现状：`performCapVerification` 内部抛的 40111 YouAreBot 被自身 catch
 * 吞掉 → 外部永远只能观察到 40116/40117（40111 不可达，登记于 DESIGN-ISSUES）。
 */

vi.mock('@/modules/security/cap/cap.service', () => ({
  AppCapJS: { validateToken: vi.fn() },
}))

// eslint-disable-next-line ts/unbound-method -- AppCapJS 是 vi.mock 工厂替换的对象，属性即 vi.fn（不涉及 this 绑定）
const validateTokenMock = AppCapJS.validateToken as unknown as ReturnType<typeof vi.fn>

interface CapGuardMocks {
  getCapTokenCache: ReturnType<typeof vi.fn>
  runWithLock: ReturnType<typeof vi.fn>
  markChallengeHandled: ReturnType<typeof vi.fn>
}

function createGuard(): { guard: WalnutAdminGuardCap, mocks: CapGuardMocks } {
  const mocks: CapGuardMocks = {
    getCapTokenCache: vi.fn(async () => null),
    runWithLock: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    markChallengeHandled: vi.fn(async () => undefined),
  }

  const guard = new WalnutAdminGuardCap(
    { getAllAndOverride: () => false } as never,
    { runWithLock: mocks.runWithLock } as never,
    { getCapTokenCache: mocks.getCapTokenCache, setCapTokenCache: vi.fn() } as never,
    { markChallengeHandled: mocks.markChallengeHandled } as never,
  )

  return { guard, mocks }
}

function createContext(shouldChallenge: boolean): ExecutionContext {
  const request = {
    isPostman: false,
    signedCookies: {
      [WalnutAdminConstCookieKeys.CAPJS_TOKEN]: 'g9-invalid-token',
      [WalnutAdminConstCookieKeys.DEVICE_ID]: 'g9-device',
    },
    risk: {
      comprehensive: {
        recommendation: { shouldChallenge, criticalFactors: [] },
      },
    },
  }

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function capGuardSpecHandler() {},
    getClass: () => class CapGuardSpecController {},
  } as unknown as ExecutionContext
}

describe('cap guard G9：真验失败（success=false）与缓存 miss', () => {
  it('shouldChallenge=true + 无效 token + 缓存 miss → 40116 CapInteractionRequired', async () => {
    validateTokenMock.mockResolvedValue({ success: false })
    const { guard, mocks } = createGuard()

    await expect(guard.canActivate(createContext(true)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionCapInteractionRequired)

    // 真验腿真实走到：缓存 miss → 锁内 validateToken；失败后不写验证缓存
    expect(mocks.getCapTokenCache).toHaveBeenCalled()
    expect(validateTokenMock).toHaveBeenCalledWith('g9-invalid-token')
  })

  it('shouldChallenge=false + 无效 token + 缓存 miss → 40117 CapRefreshRequired（策略降级仍拒）', async () => {
    validateTokenMock.mockResolvedValue({ success: false })
    const { guard } = createGuard()

    await expect(guard.canActivate(createContext(false)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionCapRefreshRequired)
  })

  it('p3-31 现状：40111 YouAreBot 在 performCapVerification 内部抛出后即被自身 catch 吞掉（外部不可达）', async () => {
    validateTokenMock.mockResolvedValue({ success: false })
    const { guard } = createGuard()

    const error = await guard.canActivate(createContext(true)).catch((e: unknown) => e)

    // 观察到的只能是 40116；40111 分支被自身 catch 吞掉，永远到不了调用方
    expect(error).toBeInstanceOf(WalnutAdminExceptionCapInteractionRequired)
    expect(error).not.toBeInstanceOf(WalnutAdminExceptionYouAreBot)
  })
})

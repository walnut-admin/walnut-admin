import type { ExecutionContext } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminExceptionRiskUnavailable } from '@walnut-server/exceptions/base/406'
import {
  WalnutAdminExceptionCapInteractionRequired,
  WalnutAdminExceptionCapRefreshRequired,
  WalnutAdminExceptionYouAreBot,
} from '@walnut-server/exceptions/business/auth'
import { AppCapJS } from '@walnut-server/security/cap/cap.service'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WalnutAdminGuardCap } from '../cap.guard'

/**
 * CAP guard 的三条出口（review CAP-4 / CAP-6）：
 *
 * | 输入 | 出口 | 为什么 |
 * |------|------|--------|
 * | cookie 缺失 / 签名错的 `false` / 空串 | 40116 / 40117 | 凭据本身不成立，客户端拿新的即可自愈 |
 * | cookie 是字符串但**不是 cap.js token 形态** | **40111** | 本地可证的伪造/损坏凭据（P3-31 死码修复） |
 * | 形态合法但 cap.js 判 `success:false` | 40116 / 40117 | 一次性 token 已消费 / 过期 —— 必须能自愈 |
 * | `validateToken` 抛异常（存储坏 / 只读 FS） | 40116 / 40117 | 设施故障不能冤枉用户是机器人 |
 *
 * 「旧写法会红」对照：
 * - 用例 1（畸形 cookie）在旧代码里 `isNil(false) === false` ⇒ 继续往下走
 *   ⇒ 真实链路是 `createHash().update(false)` 抛 ERR_INVALID_ARG_TYPE ⇒ body.code 50000。
 *   本文件用「`getCapTokenCache` 是否被调用」把它钉住（旧代码会带着 `false` 调进去）。
 * - 用例 3（不是 cap.js token）在旧代码里被 `catch` 吞成 false ⇒ 40116；现在是 40111。
 */

vi.mock('@walnut-server/security/cap/cap.service', () => ({
  AppCapJS: { validateToken: vi.fn() },
}))

// eslint-disable-next-line ts/unbound-method -- AppCapJS 是 vi.mock 工厂替换的对象，属性即 vi.fn（不涉及 this 绑定）
const validateTokenMock = AppCapJS.validateToken as unknown as ReturnType<typeof vi.fn>

interface CapGuardMocks {
  getCapTokenCache: ReturnType<typeof vi.fn>
  setCapTokenCache: ReturnType<typeof vi.fn>
  runWithLock: ReturnType<typeof vi.fn>
  markChallengeHandled: ReturnType<typeof vi.fn>
}

function createGuard(): { guard: WalnutAdminGuardCap, mocks: CapGuardMocks } {
  const mocks: CapGuardMocks = {
    getCapTokenCache: vi.fn(async () => null),
    setCapTokenCache: vi.fn(async () => undefined),
    runWithLock: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    markChallengeHandled: vi.fn(async () => undefined),
  }

  const guard = new WalnutAdminGuardCap(
    { getAllAndOverride: () => false } as never,
    { runWithLock: mocks.runWithLock } as never,
    { getCapTokenCache: mocks.getCapTokenCache, setCapTokenCache: mocks.setCapTokenCache } as never,
    { markChallengeHandled: mocks.markChallengeHandled } as never,
  )

  return { guard, mocks }
}

function createContext(shouldChallenge: boolean, capToken: unknown): ExecutionContext {
  const request = {
    isPostman: false,
    signedCookies: {
      [WalnutAdminConstCookieKeys.CAPJS_TOKEN]: capToken,
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

/** cap.js 真实 token 形态：`<id>:<vertoken>`，两段 hex */
const WELL_FORMED_TOKEN = 'deadbeefcafe1234:cafebabedead5678'

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error)
}

// 模块级 mock 的调用历史会跨用例累积（validateTokenMock 是单例）——
// 每条用例都从「零调用」开始，否则 `not.toHaveBeenCalled` 这类断言会读到上一条的残留
beforeEach(() => {
  validateTokenMock.mockReset()
})

describe('cap guard：畸形 cookie 不再 500（review CAP-4）', () => {
  it('签名错的 false（cookie-parser 的坏签名出口）+ shouldChallenge=true ⇒ 40116，且不进缓存/哈希', async () => {
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext(true, false)))

    expect(error).toBeInstanceOf(WalnutAdminExceptionCapInteractionRequired)
    // 旧写法：isNil(false) === false ⇒ 继续 ⇒ 带着 boolean 去 createHash().update() ⇒ 50000
    expect(mocks.getCapTokenCache).not.toHaveBeenCalled()
    expect(validateTokenMock).not.toHaveBeenCalled()
  })

  it('签名错的 false + shouldChallenge=false ⇒ 40117（与「缺失」同一语义）', async () => {
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext(false, false)))

    expect(error).toBeInstanceOf(WalnutAdminExceptionCapRefreshRequired)
    expect(mocks.getCapTokenCache).not.toHaveBeenCalled()
  })

  it('cookie 缺失（undefined）⇒ 40116 / 40117（既有语义不变）', async () => {
    const { guard } = createGuard()

    await expect(guard.canActivate(createContext(true, undefined)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionCapInteractionRequired)

    await expect(guard.canActivate(createContext(false, undefined)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionCapRefreshRequired)
  })

  it('空串 cookie 按缺失处理（不会拿空串去算指纹）', async () => {
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext(true, '')))

    expect(error).toBeInstanceOf(WalnutAdminExceptionCapInteractionRequired)
    expect(mocks.getCapTokenCache).not.toHaveBeenCalled()
  })
})

describe('cap guard：40111 真能抛出来（review CAP-6 / P3-31 死码修复）', () => {
  it('cookie 是字符串但不是 cap.js token 形态 ⇒ 40111 YouAreBot（旧写法给 40116）', async () => {
    const { guard } = createGuard()

    const error = await caught(guard.canActivate(createContext(true, 'not-a-capjs-token')))

    expect(error).toBeInstanceOf(WalnutAdminExceptionYouAreBot)
    // 旧代码这一条只能观察 40116（throw 被 performCapVerification 自己的 catch 吞掉）
    expect(error).not.toBeInstanceOf(WalnutAdminExceptionCapInteractionRequired)
    // 形态非法在本地就拒，不必打第三方
    expect(validateTokenMock).not.toHaveBeenCalled()
  })

  it('shouldChallenge=false 时形态非法仍是 40111（不是 refresh）', async () => {
    const { guard } = createGuard()

    const error = await caught(guard.canActivate(createContext(false, 'forged:value:with:extra')))

    expect(error).toBeInstanceOf(WalnutAdminExceptionYouAreBot)
  })
})

describe('cap guard：真验失败 / 设施故障仍是可自愈的 40116 / 40117', () => {
  it('shouldChallenge=true + success:false + 缓存 miss ⇒ 40116，且不写验证缓存', async () => {
    validateTokenMock.mockResolvedValue({ success: false })
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext(true, WELL_FORMED_TOKEN)))

    expect(error).toBeInstanceOf(WalnutAdminExceptionCapInteractionRequired)
    expect(error).not.toBeInstanceOf(WalnutAdminExceptionYouAreBot)

    expect(mocks.getCapTokenCache).toHaveBeenCalled()
    expect(validateTokenMock).toHaveBeenCalledWith(WELL_FORMED_TOKEN)
    expect(mocks.setCapTokenCache).not.toHaveBeenCalled()
  })

  it('shouldChallenge=false + success:false ⇒ 40117（策略降级仍拒，但可无感刷新自愈）', async () => {
    validateTokenMock.mockResolvedValue({ success: false })
    const { guard } = createGuard()

    await expect(guard.canActivate(createContext(false, WELL_FORMED_TOKEN)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionCapRefreshRequired)
  })

  it('validateToken 抛异常（.data 存储坏 / 只读 FS）⇒ 40116，不是 40111（不冤枉用户）', async () => {
    validateTokenMock.mockRejectedValue(new Error('ENOENT: .data/tokensList.json'))
    const { guard } = createGuard()

    const error = await caught(guard.canActivate(createContext(true, WELL_FORMED_TOKEN)))

    expect(error).toBeInstanceOf(WalnutAdminExceptionCapInteractionRequired)
    expect(error).not.toBeInstanceOf(WalnutAdminExceptionYouAreBot)
  })
})

describe('cap guard：通过路径', () => {
  it('缓存命中 ⇒ 直接放行，不再问 cap.js', async () => {
    const { guard, mocks } = createGuard()
    mocks.getCapTokenCache.mockResolvedValue(true)

    await expect(guard.canActivate(createContext(true, WELL_FORMED_TOKEN))).resolves.toBe(true)
    expect(validateTokenMock).not.toHaveBeenCalled()
  })

  it('缓存 miss + 真验通过 ⇒ 写验证缓存并放行', async () => {
    validateTokenMock.mockResolvedValue({ success: true })
    const { guard, mocks } = createGuard()

    await expect(guard.canActivate(createContext(true, WELL_FORMED_TOKEN))).resolves.toBe(true)

    expect(mocks.setCapTokenCache).toHaveBeenCalledWith('g9-device', WELL_FORMED_TOKEN)
  })
})

describe('cap guard：Risk 没留下 decision 时按端点分级（批次 8 / B2，守卫链第三腿）', () => {
  function contextWithoutRisk(method: string, path: string) {
    const request = {
      isPostman: false,
      method,
      path,
      signedCookies: {
        [WalnutAdminConstCookieKeys.CAPJS_TOKEN]: WELL_FORMED_TOKEN,
        [WalnutAdminConstCookieKeys.DEVICE_ID]: 'g9-device',
      },
    }

    return {
      request,
      context: {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => function capGuardSpecHandler() {},
        getClass: () => class CapGuardSpecController {},
      } as unknown as ExecutionContext,
    }
  }

  it('敏感端点（POST /auth/otp/verify）没有 risk decision ⇒ 40667，不再「allowing request」', async () => {
    const { guard } = createGuard()
    const { context } = contextWithoutRisk('POST', '/w/v1/auth/otp/verify')

    await expect(guard.canActivate(context))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionRiskUnavailable)
    // 旧实现 return true ⇒ 无人机验证也能过（负对照）
    expect(validateTokenMock).not.toHaveBeenCalled()
  })

  it('非敏感端点没有 risk decision ⇒ 放行 + riskDegraded = risk-recommendation-missing', async () => {
    const { guard } = createGuard()
    const { context, request } = contextWithoutRisk('GET', '/w/v1/system/locale/message/zh_CN')

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(request).toMatchObject({ riskDegraded: 'risk-recommendation-missing' })
  })
})

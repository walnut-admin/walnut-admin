import type { ExecutionContext } from '@nestjs/common'
import type { SecurityRiskRateService } from '@walnut-server/security/risk/modules/rate.service'
import type { SecurityRiskService } from '@walnut-server/security/risk/risk.service'
import { Logger } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminExceptionRiskTooHigh, WalnutAdminExceptionRiskUnavailable } from '@walnut-server/exceptions/base/406'
import { describe, expect, it, vi } from 'vitest'
import { WalnutAdminGuardRisk } from '../risk.guard'

/**
 * risk guard 的两层口径：
 *
 * 1. **P1-13（2026-10-28）受控异常不被吞**：`WalnutAdminExceptionRiskTooHigh` / 40666 必须
 *    原样抛给全局异常过滤器，不能被「优雅降级」吞成 20000。产品口径同时规定风险只触发
 *    CAP 升级，正常高风险路径不再由本 guard 抛 40666。
 *
 * 2. **批次 8 / B2 降级分级**：降级不再一律放行。
 *    - 敏感端点（凭据面，清单真源 `./risk.sensitivity.ts`）+ 风控不可用（未知异常 /
 *      无 deviceId）⇒ 受控 40667 fail-close；
 *    - 其余端点 ⇒ fail-open 放行，但必须留痕到 `request.riskDegraded`
 *      （成功拦截器透出成响应壳 `meta.riskDegraded`）。
 *
 * 负对照：把 `degradeOrReject` 换回旧写法 `return true`，下面「敏感端点」四条会立刻红；
 * 把写 `riskDegraded` 的那行删掉，「留痕」两条会红。
 */

/** 非敏感端点（演示模块）—— 旧用例沿用的探测路径 */
const PUBLIC_PATH = '/walnut/v1/app/demo/list'
/** 敏感端点（实时刷新凭据）—— 带全局前缀，顺带钉住「前缀要归一化」 */
const SENSITIVE_PATH = '/walnut/v1/auth/refresh'

interface ISpecRequest {
  signedCookies: Record<string, string>
  realIp: string
  body: Record<string, unknown>
  method: string
  path: string
  riskDegraded?: string
  risk?: unknown
}

function createRequest(options: {
  path?: string
  method?: string
  withDeviceId?: boolean
} = {}): ISpecRequest {
  const { path = PUBLIC_PATH, method = 'GET', withDeviceId = true } = options

  return {
    signedCookies: withDeviceId
      ? { [WalnutAdminConstCookieKeys.DEVICE_ID]: 'p1-13-device' }
      : {},
    realIp: '203.0.113.7',
    body: { userName: 'p1-13-user' },
    method,
    path,
  }
}

function createContext(request: ISpecRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext
}

function createGuard(evaluate: () => Promise<unknown>) {
  const riskService = {
    evaluateComprehensivePreAuth: evaluate,
    evaluateComprehensivePostAuth: evaluate,
  } as unknown as SecurityRiskService

  const rateService = {
    collectPreAuth: async () => {},
    collectPostAuth: async () => {},
  } as unknown as SecurityRiskRateService

  return new WalnutAdminGuardRisk(riskService, rateService)
}

/** 关掉 warn/error 噪声（降级路径会真的打日志） */
async function silently<T>(fn: () => Promise<T>): Promise<T> {
  const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  try {
    return await fn()
  }
  finally {
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  }
}

const HIGH_RISK_RESULT = {
  overallScore: 1,
  overallLevel: 'CRITICAL',
  preAuth: {
    score: 1,
    level: 'CRITICAL',
    ip: { score: 1, level: 'CRITICAL', factors: [] },
    device: { score: 1, level: 'CRITICAL', factors: [] },
    failedLogin: { score: 0, level: 'LOW', factors: [] },
    location: { score: 0, level: 'LOW', factors: [] },
    rate: { score: 0, level: 'LOW', factors: [] },
  },
  allFactors: [],
  recommendation: { shouldChallenge: true, shouldLog: true, reason: 'HIGH_RISK(1)' },
  evaluatedAt: Date.now(),
}

describe('risk guard：受控异常不被 catch 吞（P1-13）', () => {
  it('riskTooHigh（40666）→ 原样抛给全局过滤器（不是降级放行）', async () => {
    const guard = createGuard(async () => {
      throw new WalnutAdminExceptionRiskTooHigh()
    })

    await expect(guard.canActivate(createContext(createRequest()))).rejects.toBeInstanceOf(WalnutAdminExceptionRiskTooHigh)
  })

  it('high risk evaluation → 放行并挂 request.risk（CAP guard 消费 shouldChallenge），本 guard 不抛 40666', async () => {
    const guard = createGuard(async () => HIGH_RISK_RESULT)
    const request = createRequest()

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true)
    // 有评估结果 ⇒ 不是降级，不许留痕（否则 meta.riskDegraded 会变成噪声）
    expect(request.riskDegraded).toBeUndefined()
  })
})

describe('risk guard：非敏感端点维持 fail-open，但必须留痕（批次 8 / B2）', () => {
  it('未知异常 → 放行，且 riskDegraded = risk-evaluation-failed', async () => {
    const guard = createGuard(async () => {
      throw new Error('risk backend down')
    })
    const request = createRequest({ path: PUBLIC_PATH })

    const allowed = await silently(async () => guard.canActivate(createContext(request)))

    expect(allowed).toBe(true)
    // 旧实现的 `return true` 不写这行 ⇒ 本断言在旧代码上红（负对照）
    expect(request.riskDegraded).toBe('risk-evaluation-failed')
  })

  it('拿不到 deviceId → 放行，且 riskDegraded = no-device-id', async () => {
    const guard = createGuard(async () => HIGH_RISK_RESULT)
    const request = createRequest({ path: PUBLIC_PATH, withDeviceId: false })

    const allowed = await silently(async () => guard.canActivate(createContext(request)))

    expect(allowed).toBe(true)
    expect(request.riskDegraded).toBe('no-device-id')
    // 没评估结果 ⇒ 不能假装有（CAP guard 靠这个区分）
    expect(request.risk).toBeUndefined()
  })
})

describe('risk guard：敏感端点 fail-close（批次 8 / B2）', () => {
  it('未知异常 + 敏感端点（POST /auth/refresh）⇒ 40667，不放行', async () => {
    const guard = createGuard(async () => {
      throw new Error('risk backend down')
    })
    const request = createRequest({ path: SENSITIVE_PATH, method: 'POST' })

    const error = await silently(async () => guard.canActivate(createContext(request)).then(() => null, (e: unknown) => e))

    expect(error).toBeInstanceOf(WalnutAdminExceptionRiskUnavailable)
    // 旧实现 return true ⇒ 这里是 null（负对照）
    expect(request.riskDegraded).toBeUndefined()
  })

  it('拿不到 deviceId + 敏感端点 ⇒ 40667（旧实现直接 return true，登录链裸奔）', async () => {
    const guard = createGuard(async () => HIGH_RISK_RESULT)
    const request = createRequest({ path: SENSITIVE_PATH, method: 'POST', withDeviceId: false })

    await silently(async () => expect(guard.canActivate(createContext(request)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionRiskUnavailable))
  })

  it('前缀归一化：/w/v1/auth/refresh 与 /auth/refresh 都是 fail-close', async () => {
    for (const path of ['/w/v1/auth/refresh', '/auth/refresh']) {
      const guard = createGuard(async () => {
        throw new Error('risk backend down')
      })

      await silently(async () => expect(guard.canActivate(createContext(createRequest({ path, method: 'POST' }))))
        .rejects
        .toBeInstanceOf(WalnutAdminExceptionRiskUnavailable))
    }
  })

  it('同一条路径换个谓词就不算敏感（GET /auth/refresh 不存在 ⇒ 非敏感端点 fail-open）', async () => {
    const guard = createGuard(async () => {
      throw new Error('risk backend down')
    })
    const request = createRequest({ path: '/w/v1/auth/refresh', method: 'GET' })

    await silently(async () => expect(guard.canActivate(createContext(request))).resolves.toBe(true))
    expect(request.riskDegraded).toBe('risk-evaluation-failed')
  })
})

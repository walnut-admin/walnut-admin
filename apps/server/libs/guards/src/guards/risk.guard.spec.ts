import type { ExecutionContext } from '@nestjs/common'
import type { SecurityRiskRateService } from '@walnut-server/security/risk/modules/rate.service'
import type { SecurityRiskService } from '@walnut-server/security/risk/risk.service'
import { Logger } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminExceptionRiskTooHigh } from '@walnut-server/exceptions/base/406'
import { describe, expect, it, vi } from 'vitest'
import { WalnutAdminGuardRisk } from './risk.guard'

/**
 * P1-13（2026-10-28）：risk.guard 的 catch 只吞未知异常 —— 受控 HttpException
 * （WalnutAdminExceptionRiskTooHigh / 40666）必须放行到全局异常过滤器，不能被
 * 「优雅降级」吞成 20000。产品口径同时规定风险只触发 CAP 升级：正常高风险路径不再
 * 由本 guard 抛 40666，而是把 recommendation.shouldChallenge 交给 CAP guard。
 */

function createContext(): ExecutionContext {
  const request = {
    signedCookies: { [WalnutAdminConstCookieKeys.DEVICE_ID]: 'p1-13-device' },
    realIp: '203.0.113.7',
    body: { userName: 'p1-13-user' },
    path: '/walnut/v1/app/demo/list',
  }

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

describe('risk guard：受控异常不被 catch 吞（P1-13）', () => {
  it('riskTooHigh（40666）→ 原样抛给全局过滤器（不再 return true 降级）', async () => {
    const guard = createGuard(async () => {
      throw new WalnutAdminExceptionRiskTooHigh()
    })

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(WalnutAdminExceptionRiskTooHigh)
  })

  it('unknown error → 保持优雅降级放行（return true）', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      const guard = createGuard(async () => {
        throw new Error('risk backend down')
      })

      await expect(guard.canActivate(createContext())).resolves.toBe(true)
      expect(errorSpy).toHaveBeenCalled()
    }
    finally {
      errorSpy.mockRestore()
    }
  })

  it('high risk evaluation → 放行并挂 request.risk（CAP guard 消费 shouldChallenge），本 guard 不抛 40666', async () => {
    const guard = createGuard(async () => ({
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
    }))

    await expect(guard.canActivate(createContext())).resolves.toBe(true)
  })
})

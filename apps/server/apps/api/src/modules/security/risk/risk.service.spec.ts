import { describe, expect, it } from 'vitest'
import { SecurityRiskService } from './risk.service'

/**
 * P1-13（2026-10-28，产品口径「风险只触发 CAP 升级，不做阻塞」）：
 * `generateRecommendation` 的 shouldBlock 恒 false 字段已从类型与返回面摘除 ——
 * 高风险/中风险的唯一出口是 shouldChallenge（由 CAP guard 消费），不再存在阻塞腿。
 */

const CRITICAL_RESULT = { score: 1, level: 'CRITICAL', factors: [] }
const HIGH_RESULT = { score: 0.7, level: 'HIGH', factors: [] }
const MEDIUM_RESULT = { score: 0.5, level: 'MEDIUM', factors: [] }
const LOW_RESULT = { score: 0, level: 'LOW', factors: [] }

function createService(result: typeof CRITICAL_RESULT) {
  const config = {
    moduleWeights: {
      IP: 0.25,
      DEVICE: 0.25,
      FAILED_LOGIN: 0.2,
      LOCATION: 0.15,
      RATE: 0.15,
      USER: 0.2,
      USER_DEVICE: 0.3,
    },
    getPreAuthCriticalFactors: () => new Set<string>(),
    getPostAuthCriticalFactors: () => new Set<string>(),
  }

  const evaluator = {
    evaluateIP: async () => result,
    evaluateDevice: async () => result,
    evaluateFailedLogin: async () => result,
    evaluateLocationRisk: async () => result,
    evaluateRateRisk: async () => result,
    evaluateUser: async () => result,
    evaluateUserDevice: async () => result,
  }

  const challengeState = {
    batchCheckChallenges: async () => new Map<string, boolean>(),
    clearChallenges: async () => {},
    markChallengeHandled: async () => {},
  }

  return new SecurityRiskService(
    config as never,
    evaluator as never,
    evaluator as never,
    evaluator as never,
    evaluator as never,
    evaluator as never,
    evaluator as never,
    evaluator as never,
    challengeState as never,
  )
}

async function recommendFor(result: typeof CRITICAL_RESULT) {
  const service = createService(result)
  const res = await service.evaluateComprehensivePreAuth({ ip: '203.0.113.7', deviceId: 'p1-13-device' })
  return res.recommendation
}

describe('risk service：推荐口径只含 CAP 升级，无阻塞字段（P1-13）', () => {
  it('critical → shouldChallenge=true / shouldLog=true，且不含 shouldBlock 字段', async () => {
    const recommendation = await recommendFor(CRITICAL_RESULT)

    expect(recommendation.shouldChallenge).toBe(true)
    expect(recommendation.shouldLog).toBe(true)
    expect(recommendation.reason).toContain('HIGH_RISK')
    expect(recommendation).not.toHaveProperty('shouldBlock')
  })

  it('high（0.7，阈值 0.6 ≤ x < 0.8）→ shouldChallenge=true / reason HIGH_RISK（G11 补 HIGH 层）', async () => {
    const recommendation = await recommendFor(HIGH_RESULT)

    expect(recommendation.shouldChallenge).toBe(true)
    expect(recommendation.shouldLog).toBe(true)
    expect(recommendation.reason).toContain('HIGH_RISK')
    expect(recommendation).not.toHaveProperty('shouldBlock')
  })

  it('medium → 只记录不挑战（shouldChallenge=false），仍无 shouldBlock', async () => {
    const recommendation = await recommendFor(MEDIUM_RESULT)

    expect(recommendation.shouldChallenge).toBe(false)
    expect(recommendation.shouldLog).toBe(true)
    expect(recommendation).not.toHaveProperty('shouldBlock')
  })

  it('low → 不挑战不记录，仍无 shouldBlock', async () => {
    const recommendation = await recommendFor(LOW_RESULT)

    expect(recommendation.shouldChallenge).toBe(false)
    expect(recommendation.shouldLog).toBe(false)
    expect(recommendation).not.toHaveProperty('shouldBlock')
  })
})

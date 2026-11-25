/**
 * `lib/wait-budget.ts`：总预算的算术与耗尽判据。
 *
 * 预算的语义只有三条：从起点计时、单步取 min(上限, 剩余)、耗尽时点名步骤。
 * 第三条是排障价值所在 —— 没有它，超时只会说「120s 到了」，不会说「卡在 MFA 落地」。
 */
import { describe, expect, it } from 'vitest'
import { budgetStep, remainingBudget, startWaitBudget } from './wait-budget.ts'

describe('startWaitBudget / remainingBudget', () => {
  it('从起点开始扣减', () => {
    const budget = startWaitBudget(90_000, 1_000)
    expect(remainingBudget(budget, 1_000)).toBe(90_000)
    expect(remainingBudget(budget, 31_000)).toBe(60_000)
  })

  it('超过总预算后为负（由 budgetStep 判耗尽）', () => {
    const budget = startWaitBudget(90_000, 0)
    expect(remainingBudget(budget, 95_000)).toBe(-5_000)
  })
})

describe('budgetStep', () => {
  it('正常情况返回该步上限', () => {
    const budget = startWaitBudget(90_000, 0)
    expect(budgetStep(budget, '打开登录页', 30_000, 1_000)).toBe(30_000)
  })

  it('剩余不足该步上限时按剩余收窄', () => {
    const budget = startWaitBudget(90_000, 0)
    // 已过 80s，还剩 10s：40s 的落地等待只能给 10s
    expect(budgetStep(budget, '登录落地', 40_000, 80_000)).toBe(10_000)
  })

  it('恰好耗尽 ⇒ 抛错并点名即将开始的步骤', () => {
    const budget = startWaitBudget(90_000, 0)
    expect(() => budgetStep(budget, 'MFA 验证', 20_000, 90_000)).toThrow(/90s 总预算/)
    expect(() => budgetStep(budget, 'MFA 验证', 20_000, 90_000)).toThrow(/MFA 验证/)
  })

  it('永远不返回 0（0 在 Playwright 里是「无超时」）', () => {
    const budget = startWaitBudget(90_000, 0)
    expect(budgetStep(budget, '临界', 30_000, 89_999)).toBe(1)
  })
})

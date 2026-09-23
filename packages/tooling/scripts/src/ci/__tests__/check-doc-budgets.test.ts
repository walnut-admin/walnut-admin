/**
 * 文档字数预算的**纯逻辑**用例。
 *
 * 重点在两个方向都不许漏：超上限要红（膨胀），**用量过低也要红**（预算已经失效）。
 * 后者是本门禁区别于普通「文件别太长」检查的地方 —— 一个没人接近的上限是个会腐烂的常数。
 */

import type { DocBudget } from '../check-doc-budgets.ts'
import { describe, expect, it } from 'vitest'
import { DOC_BUDGETS, evaluateBudgets, STALE_RATIO } from '../check-doc-budgets.ts'

function budget(file: string, maxChars: number): DocBudget {
  return { file, maxChars, why: '用例' }
}

/** 造一个「用量正好是上限的 ratio 倍」的读取器 */
function readerOfLengths(lengths: Record<string, number>) {
  return (file: string) => 'x'.repeat(lengths[file] ?? 0)
}

describe('evaluateBudgets —— 上界', () => {
  it('刚好等于上限不报（边界是闭的）', () => {
    const [findings] = evaluateBudgets([budget('a.md', 100)], readerOfLengths({ 'a.md': 100 }))
    expect(findings).toEqual([])
  })

  it('超一个字符就报 over，并说清超了多少', () => {
    const [findings] = evaluateBudgets([budget('a.md', 100)], readerOfLengths({ 'a.md': 101 }))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('over')
    expect(findings[0]?.message).toContain('超预算 1 字符')
  })
})

describe('evaluateBudgets —— 下界（预算过期）', () => {
  it('用量低于上限一半时报 stale', () => {
    const [findings] = evaluateBudgets([budget('a.md', 100)], readerOfLengths({ 'a.md': 49 }))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('stale')
    expect(findings[0]?.message).toContain('约束不到任何东西')
  })

  it('正好一半不报（阈值是开区间）', () => {
    const [findings] = evaluateBudgets([budget('a.md', 100)], readerOfLengths({ 'a.md': 50 }))
    expect(findings).toEqual([])
  })

  it('阈值就是导出的 STALE_RATIO（改常量不会让用例说谎）', () => {
    const maxChars = 1000
    const justUnder = Math.floor(maxChars * STALE_RATIO) - 1
    const [findings] = evaluateBudgets([budget('a.md', maxChars)], readerOfLengths({ 'a.md': justUnder }))
    expect(findings[0]?.kind).toBe('stale')
  })
})

describe('evaluateBudgets —— 读数', () => {
  it('每个预算都给一条读数（含通过的），百分比四舍五入', () => {
    const [, reports] = evaluateBudgets(
      [budget('a.md', 100), budget('b.md', 3)],
      readerOfLengths({ 'a.md': 86, 'b.md': 3 }),
    )
    expect(reports).toEqual([
      { file: 'a.md', chars: 86, maxChars: 100, percent: 86 },
      { file: 'b.md', chars: 3, maxChars: 3, percent: 100 },
    ])
  })
})

describe('仓库真实预算表', () => {
  it('每条都有文件、正的上限，以及一段说得清「凭什么」的理由', () => {
    expect(DOC_BUDGETS.length).toBeGreaterThan(0)
    for (const b of DOC_BUDGETS) {
      expect(b.file, JSON.stringify(b)).toMatch(/\.md$/)
      expect(b.maxChars).toBeGreaterThan(0)
      // 理由不许敷衍：这一列是给人看「凭什么给这个数」的
      expect(b.why.length, `${b.file} 的理由太短`).toBeGreaterThan(30)
    }
  })

  it('没有重复文件', () => {
    const files = DOC_BUDGETS.map(b => b.file)
    expect(new Set(files).size).toBe(files.length)
  })

  it('server 的包级指引被**显式**排除（不是静默漏掉）', () => {
    // 它 509 行 / 16525 字符，是官方建议的 2.5 倍；给它设预算会让门禁当场红、逼着立刻拆分。
    // 拆分是对的但属于独立的文档重构 ⇒ 排除，且排除这件事写在模块注释里。
    expect(DOC_BUDGETS.map(b => b.file)).not.toContain('apps/server/AGENTS.md')
  })
})

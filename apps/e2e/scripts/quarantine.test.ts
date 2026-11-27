/**
 * `scripts/quarantine.ts` 的纯函数：名单校验、grep 构造、到期判定。
 *
 * 为什么值得钉：名单错了不会让任何代码红 —— 只会让「已隔离」悄悄变成「没隔离」，
 * 现象是某天 nightly 突然红。校验必须在 config 加载期就把难查的形态拒掉。
 */
import { describe, expect, it } from 'vitest'
import {
  buildQuarantineGrepInvert,
  escapeRegExp,
  overdueEntries,
  parseQuarantine,
} from './quarantine.ts'

function entry(overrides: Partial<Record<'testName' | 'issue' | 'owner' | 'addedAt' | 'reviewAt', string>> = {}) {
  return {
    testName: 'U8 40605 自愈',
    issue: '#123',
    owner: '@alice',
    addedAt: '2026-11-25',
    reviewAt: '2026-12-25',
    ...overrides,
  }
}

describe('parseQuarantine', () => {
  it('空列表合法（零影响起步状态）', () => {
    expect(parseQuarantine([])).toEqual([])
  })

  it('接受完整条目', () => {
    expect(parseQuarantine([entry()])).toEqual([entry()])
  })

  it('顶层不是数组 ⇒ 拒绝', () => {
    expect(() => parseQuarantine({})).toThrow(/顶层必须是数组/)
    expect(() => parseQuarantine(null)).toThrow(/顶层必须是数组/)
  })

  it('缺字段 / 空串 / 非字符串 ⇒ 拒绝（不许静默变成「没隔离」）', () => {
    expect(() => parseQuarantine([entry({ issue: '' })])).toThrow(/issue/)
    expect(() => parseQuarantine([{ ...entry(), owner: 1 }])).toThrow(/owner/)
  })

  it('日期必须是 YYYY-MM-DD', () => {
    expect(() => parseQuarantine([entry({ addedAt: '2026/11/25' })])).toThrow(/addedAt/)
    expect(() => parseQuarantine([entry({ reviewAt: '2026-12-25T00:00:00Z' })])).toThrow(/reviewAt/)
  })

  it('同一用例重复登记 ⇒ 拒绝', () => {
    expect(() => parseQuarantine([entry(), entry()])).toThrow(/重复登记/)
  })
})

describe('buildQuarantineGrepInvert', () => {
  it('空名单 ⇒ undefined（不挂任何排除）', () => {
    expect(buildQuarantineGrepInvert([])).toBeUndefined()
  })

  it('按标题字面匹配（正则元字符不生效）', () => {
    const pattern = buildQuarantineGrepInvert([entry({ testName: 'U8 自愈：cookie(丢)' })])
    expect(pattern).toBeInstanceOf(RegExp)
    expect(pattern!.test('设备 ID 生命周期 U8 自愈：cookie(丢)')).toBe(true)
    // 若没有转义，`(丢)` 会被当作分组，反过来能匹配「cookie丢」；这里必须不命中
    expect(pattern!.test('U8 自愈：cookie丢')).toBe(false)
    expect(pattern!.test('无关用例')).toBe(false)
  })

  it('多条名单用 | 并联', () => {
    const pattern = buildQuarantineGrepInvert([
      entry({ testName: 'A 用例' }),
      entry({ testName: 'B 用例' }),
    ])
    expect(pattern!.test('x A 用例 y')).toBe(true)
    expect(pattern!.test('B 用例')).toBe(true)
    expect(pattern!.test('C 用例')).toBe(false)
  })
})

describe('escapeRegExp', () => {
  it('转义全部正则元字符', () => {
    expect(escapeRegExp('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe('a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o')
  })
})

describe('overdueEntries', () => {
  it('reviewAt 早于今天 ⇒ 到期（等值不算）', () => {
    const entries = [
      entry({ testName: 'A', reviewAt: '2026-11-24' }),
      entry({ testName: 'B', reviewAt: '2026-11-25' }),
      entry({ testName: 'C', reviewAt: '2026-11-26' }),
    ]
    expect(overdueEntries(entries, '2026-11-25').map(item => item.testName)).toEqual(['A'])
  })
})

/**
 * `src/db/seed-verify.ts` 的用例 —— **对拍器本身**的可信度。
 *
 * 这条很重要：`db:seed:verify` 是全批验收的**唯一判据**，如果它的 diff 函数把「不等」判成「等」，
 * 整个验收就是安慰剂。所以这里用三组人造输入把「相等 / 只在 A / 只在 B」三种结论钉死。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_BASELINE_REF, diffTableRows, parseSeedVerifyArgs } from '../seed-verify.ts'

describe('diffTableRows（对拍判据）', () => {
  it('两侧行集相同（顺序无关）→ 无差异', () => {
    const diff = diffTableRows('sys_user', ['a', 'b'], ['b', 'a'])
    expect(diff.firstDifference).toBeNull()
    expect(diff).toMatchObject({ table: 'sys_user', rowsA: 2, rowsB: 2 })
  })

  it('基线库多一行 → 报差异并打印那一行', () => {
    const diff = diffTableRows('sys_role', ['a', 'b'], ['a'])
    expect(diff.firstDifference).toContain('A 独有 1 行 / B 独有 0 行')
    expect(diff.firstDifference).toContain('A: b')
  })

  it('仓内库多一行 → 报差异并打印那一行', () => {
    const diff = diffTableRows('sys_role', ['a'], ['a', 'c'])
    expect(diff.firstDifference).toContain('A 独有 0 行 / B 独有 1 行')
    expect(diff.firstDifference).toContain('B: c')
  })

  it('同数量但值不同 → 仍然报（不是只看行数）', () => {
    expect(diffTableRows('t', ['a', 'b'], ['a', 'z']).firstDifference).not.toBeNull()
  })

  it('两侧都空 → 相等（空表是合法结果，不该判红）', () => {
    expect(diffTableRows('t', [], []).firstDifference).toBeNull()
  })
})

describe('参数解析', () => {
  it('默认基线是批次 5-B 的那个提交', () => {
    expect(parseSeedVerifyArgs([]).baselineRef).toBe(DEFAULT_BASELINE_REF)
    expect(DEFAULT_BASELINE_REF).toBe('07dacfd6')
  })

  it('两个库名不能相同（互相覆盖会让对拍失去意义）', () => {
    expect(() => parseSeedVerifyArgs(['--db-a', 'x', '--db-b', 'x'])).toThrow(/不能是同一个库/)
  })

  it('未知参数抛', () => {
    expect(() => parseSeedVerifyArgs(['--nope'])).toThrow(/未知参数/)
  })
})

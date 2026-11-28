/**
 * `check` 步骤表的守卫：`pnpm check` 的覆盖面只有这张表说了算，表写错一条就是「少跑一道闸而全绿」。
 *
 * 三条判据：① id 唯一、说明非空（失败回放里要能定位到哪一步）；② argv 写在**可执行名字**上，
 * 经命令表解析后必须真的落到一条命令（拼错的 id 会被原样当成 pnpm 脚本名，退出码 1 但理由跑偏）；
 * ③ 不含 shell 连接子 —— `runArgs` 走 `spawn(…, { shell: false })`，`&&` 会被原样交给工具。
 */
import { describe, expect, it } from 'vitest'
import { resolveCommandArgv } from '../../lib/commands.ts'
import { CHECK_STEPS } from '../check.ts'

describe('check 步骤表（CHECK_STEPS）', () => {
  it('id 无重复且都非空', () => {
    const ids = CHECK_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id, 'id 不能为空').not.toBe('')
  })

  it('每步都有说明（label 太短等于没写）', () => {
    for (const step of CHECK_STEPS) expect(step.label.length).toBeGreaterThan(4)
  })

  it('每步的 argv 首词都能解析成一条真实命令（命令表 id 与可执行名字都算）', () => {
    for (const step of CHECK_STEPS) {
      const argv = resolveCommandArgv(step.argv)
      expect(argv.length, `${step.id}: 解析后 argv 为空`).toBeGreaterThan(0)
      // 单段 argv 必须被展开成至少两段（`lint:oxlint` → `exec oxlint --quiet`）。没展开说明
      // 它既不是命令表 id 也不是 pnpm 子命令前缀 —— runArgs 会把它当可执行名字，于是拼错一个
      // id 的症状是「pnpm 跑了不存在的脚本」，而不是「这条门禁没跑」。
      if (step.argv.length === 1)
        expect(
          argv.length,
          `${step.id}: 单段 argv 没有展开，${step.argv[0]} 可能是拼错的命令表 id`,
        ).toBeGreaterThanOrEqual(2)
    }
  })

  it('argv 元素里没有 shell 连接子（runArgs 是 shell: false，连接子会被原样交给工具）', () => {
    const connectors = ['&&', '||', ';', '|']
    const bad: string[] = []
    for (const step of CHECK_STEPS) {
      for (const token of step.argv) {
        for (const connector of connectors) {
          if (token.includes(connector)) bad.push(`${step.id}: \`${token}\` 含 ${connector}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('覆盖面钉住：ESLint 轨 + 类型 + 测试 + oxlint + 格式，一样都不能少', () => {
    const resolved = CHECK_STEPS.map((step) => resolveCommandArgv(step.argv).join(' '))
    expect(resolved.some((argv) => argv.includes('run lint types:check test'))).toBe(true)
    expect(resolved.some((argv) => argv.startsWith('exec oxlint'))).toBe(true)
    expect(resolved.some((argv) => argv.startsWith('exec oxfmt --check'))).toBe(true)
  })
})

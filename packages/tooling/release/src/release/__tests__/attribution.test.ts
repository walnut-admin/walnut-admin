/**
 * 归属规则：commit → 包。
 *
 * 本套用例的重点是**不变量**而不是穷举：本仓是单一 fixed 组，「归属到哪个包」不影响版本号，
 * 真正决定的是「这条提交要不要产生意图」。所以最贵的错误是**表里出现不存在的包** ——
 * 它会让一条提交为一个幽灵包写出版本意图。`SCOPE_TO_PACKAGE` 与 `workspacePackages()`
 * 的逐名比对就是拦这个的（2026-09-23 靠它查出 `'tooling': '@walnut/tooling'` 这条陈尸）。
 */

import type { ParsedCommit } from '../commit-intent.ts'
import { describe, expect, it } from 'vitest'
import {
  attributeCommit,
  buildAttributionContext,
  describeAttributionSkip,
  SCOPE_TO_PACKAGE,
  workspacePackages,
} from '../attribution.ts'

/** 造一条最小可用的提交（本模块只读 `scope`，其余字段与归属无关） */
function commit(scope: string | null): ParsedCommit {
  return {
    hash: 'deadbee',
    type: 'fix',
    scope,
    breaking: false,
    summary: 'x',
  }
}

describe('sCOPE_TO_PACKAGE —— scope 兜底表的不变量', () => {
  it('表里每个值都是真实存在的 workspace 包（没有幽灵包名）', () => {
    const real = new Set(workspacePackages().map(pkg => pkg.name))
    expect(real.size).toBeGreaterThan(0)
    const ghosts = Object.entries(SCOPE_TO_PACKAGE)
      .filter(([, pkgName]) => !real.has(pkgName))
      .map(([scope, pkgName]) => `${scope} → ${pkgName}`)
    expect(ghosts, `这些 scope 指向了不存在的包：\n  ${ghosts.join('\n  ')}`).toEqual([])
  })

  it('表里没有 `tooling` —— 它是「在册但不是包」的 scope，靠路径归属', () => {
    expect(SCOPE_TO_PACKAGE).not.toHaveProperty('tooling')
  })

  it('每个键都是 commitlint 白名单里的包名段（scope 写不出来就永远走不到）', () => {
    // commitlint 的 scope 白名单 = 包名 + 基础设施 scope（见 @walnut/commitlint-config）
    const allowed = new Set([
      ...Object.keys(SCOPE_TO_PACKAGE),
      'eslint-config',
      'commitlint-config',
      'tooling',
      'docker',
      'deploy',
      'pnpm',
      'release',
    ])
    const packageNames = new Set(workspacePackages().map(pkg => pkg.name.replace(/^@walnut\//, '')))
    for (const scope of Object.keys(SCOPE_TO_PACKAGE))
      expect(allowed.has(scope) && packageNames.has(scope), `${scope} 既不在白名单也不是包名`).toBe(true)
  })
})

describe('attributeCommit —— 路径优先、scope 兜底、否则不发版', () => {
  const context = buildAttributionContext()

  it('路径命中时按最长前缀归属，忽略 scope', () => {
    expect(attributeCommit(commit('docs'), ['packages/tooling/release/src/release/steps.ts'], context))
      .toEqual(['@walnut/release'])
  })

  it('一个提交可以命中多个包', () => {
    const got = attributeCommit(commit('admin'), ['apps/admin/src/main.ts', 'packages/platform-any/contract/src/index.ts'], context)
    expect(got).toEqual(['@walnut/admin', '@walnut/contract'])
  })

  it('路径一个包都没命中时用 scope 兜底', () => {
    expect(attributeCommit(commit('contract'), ['turbo.json'], context)).toEqual(['@walnut/contract'])
  })

  it('基础设施 scope 不产生意图', () => {
    for (const scope of ['docker', 'deploy', 'pnpm', 'release'])
      expect(attributeCommit(commit(scope), ['turbo.json'], context)).toBeNull()
  })

  it('scope=tooling 且没有路径命中时不产生意图（本该如此：没动任何包）', () => {
    expect(attributeCommit(commit('tooling'), ['turbo.json'], context)).toBeNull()
  })

  it('scope=tooling 但改了工具链包时，仍然按**路径**归属', () => {
    expect(attributeCommit(commit('tooling'), ['packages/tooling/scripts/src/lib/git.ts'], context))
      .toEqual(['@walnut/scripts'])
  })

  it('未在册的 scope 不产生意图', () => {
    expect(attributeCommit(commit('nope'), ['turbo.json'], context)).toBeNull()
  })

  it('没有 scope 且没有路径命中时不产生意图', () => {
    expect(attributeCommit(commit(null), ['turbo.json'], context)).toBeNull()
  })
})

describe('describeAttributionSkip —— 日志里要能看懂为什么没意图', () => {
  it('空改动', () => {
    expect(describeAttributionSkip(commit('contract'), [])).toBe('空改动')
  })

  it('scope=tooling 有专门的说法（不能报成「未在册的 scope」）', () => {
    const msg = describeAttributionSkip(commit('tooling'), ['turbo.json'])
    expect(msg).toContain('tooling')
    expect(msg).not.toContain('未在册')
  })

  it('基础设施 scope 如实报出', () => {
    expect(describeAttributionSkip(commit('deploy'), ['turbo.json'])).toBe('基础设施 scope（deploy）')
  })

  it('未在册的 scope 如实报出', () => {
    expect(describeAttributionSkip(commit('nope'), ['turbo.json'])).toContain('未在册的 scope（nope）')
  })
})

import type { ParsedCommit } from './auto-changeset'
import { describe, expect, it } from 'vitest'
import { BUMP_MAP, getBump, isNoise, isWorkspaceCommit, parseCommit, SCOPE_TO_PACKAGE } from './auto-changeset'

function commit(overrides: Partial<ParsedCommit> = {}): ParsedCommit {
  return {
    hash: 'abc1234',
    type: 'feat',
    scope: null,
    breaking: false,
    summary: 'default summary',
    ...overrides,
  }
}

describe('isNoise', () => {
  it('过滤 wip/fixup/squash/tmp/draft 前缀', () => {
    expect(isNoise('wip: something')).toBe(true)
    expect(isNoise('WIP: something')).toBe(true)
    expect(isNoise('fixup! feat: x')).toBe(true)
    expect(isNoise('squash! feat: x')).toBe(true)
    expect(isNoise('tmp: test')).toBe(true)
    expect(isNoise('draft: test')).toBe(true)
  })

  it('过滤纯数字与过短消息', () => {
    expect(isNoise('1')).toBe(true)
    expect(isNoise('6.4')).toBe(true)
    expect(isNoise('0527')).toBe(true)
    expect(isNoise('abc')).toBe(true)
  })

  it('保留正常消息', () => {
    expect(isNoise('feat: add login')).toBe(false)
    expect(isNoise('fix(server): bug')).toBe(false)
  })
})

describe('parseCommit', () => {
  it('解析完整 conventional commit', () => {
    expect(parseCommit('abc1234||feat(login): add remember me')).toEqual({
      hash: 'abc1234',
      type: 'feat',
      scope: 'login',
      breaking: false,
      summary: 'add remember me',
    })
  })

  it('解析破坏性变更 !', () => {
    expect(parseCommit('abc1234||feat!: breaking change')).toMatchObject({ breaking: true })
    expect(parseCommit('abc1234||fix(api)!: breaking')).toMatchObject({ breaking: true })
  })

  it('无前缀消息 type 为 null', () => {
    expect(parseCommit('abc1234||some plain message')).toMatchObject({
      type: null,
      summary: 'some plain message',
    })
  })

  it('摘要含 || 也能解析', () => {
    expect(parseCommit('abc1234||feat: a || b')?.summary).toBe('a || b')
  })

  it('噪声消息返回 null', () => {
    expect(parseCommit('abc1234||wip: nothing')).toBeNull()
    expect(parseCommit('abc1234||1')).toBeNull()
  })
})

describe('getBump', () => {
  it('按 commit 类型映射 bump', () => {
    expect(getBump(commit({ type: 'feat' }))).toBe('minor')
    expect(getBump(commit({ type: 'fix' }))).toBe('patch')
    expect(getBump(commit({ type: 'perf' }))).toBe('patch')
    expect(getBump(commit({ type: 'refactor' }))).toBe('patch')
    expect(getBump(commit({ type: 'revert' }))).toBe('patch')
  })

  it('docs/chore/style/test/build/ci 跳过', () => {
    for (const type of ['docs', 'chore', 'style', 'test', 'build', 'ci'])
      expect(getBump(commit({ type }))).toBe('skip')
  })

  it('breaking 优先 major', () => {
    expect(getBump(commit({ type: 'fix', breaking: true }))).toBe('major')
    expect(getBump(commit({ type: null, breaking: true }))).toBe('major')
  })

  it('未知类型/无类型默认 patch', () => {
    expect(getBump(commit({ type: 'custom' }))).toBe('patch')
    expect(getBump(commit({ type: null }))).toBe('patch')
  })

  it('bump 映射表完整且符合设计', () => {
    expect(BUMP_MAP).toEqual({
      feat: 'minor',
      fix: 'patch',
      perf: 'patch',
      refactor: 'patch',
      revert: 'patch',
      docs: 'skip',
      chore: 'skip',
      style: 'skip',
      test: 'skip',
      build: 'skip',
      ci: 'skip',
    })
  })
})

describe('scope 到包映射（SCOPE_TO_PACKAGE）', () => {
  it('apps 包映射', () => {
    expect(SCOPE_TO_PACKAGE.admin).toBe('@walnut/admin')
    expect(SCOPE_TO_PACKAGE.server).toBe('@walnut/server')
    expect(SCOPE_TO_PACKAGE.docs).toBe('@walnut/docs')
  })

  it('packages 包映射（含 tooling）', () => {
    expect(SCOPE_TO_PACKAGE.utils).toBe('@walnut/utils')
    expect(SCOPE_TO_PACKAGE.contract).toBe('@walnut/contract')
    expect(SCOPE_TO_PACKAGE.types).toBe('@walnut/types')
    expect(SCOPE_TO_PACKAGE.client).toBe('@walnut/client')
    expect(SCOPE_TO_PACKAGE.http).toBe('@walnut/http')
    expect(SCOPE_TO_PACKAGE.ui).toBe('@walnut/ui')
    expect(SCOPE_TO_PACKAGE['eslint-config']).toBe('@walnut/eslint-config')
    expect(SCOPE_TO_PACKAGE['commitlint-config']).toBe('@walnut/commitlint-config')
    expect(SCOPE_TO_PACKAGE.release).toBe('@walnut/release')
  })

  it('覆盖全部 12 个 workspace 包', () => {
    expect(Object.keys(SCOPE_TO_PACKAGE)).toHaveLength(12)
  })
})

describe('isWorkspaceCommit', () => {
  it('只改 docs/.github/.vscode/.changeset → 非代码提交', () => {
    expect(isWorkspaceCommit(['docs/guide.md'])).toBe(false)
    expect(isWorkspaceCommit(['.github/workflows/ci.yml'])).toBe(false)
    expect(isWorkspaceCommit(['.vscode/settings.json'])).toBe(false)
    expect(isWorkspaceCommit(['.changeset/config.json'])).toBe(false)
    expect(isWorkspaceCommit(['docs/a.md', '.github/x.yml'])).toBe(false)
  })

  it('含代码文件 → 代码提交', () => {
    expect(isWorkspaceCommit(['apps/admin/src/App.vue'])).toBe(true)
    expect(isWorkspaceCommit(['apps/server/src/main.ts'])).toBe(true)
    expect(isWorkspaceCommit(['packages/platform-any/utils-core/src/index.ts'])).toBe(true)
    expect(isWorkspaceCommit(['docs/a.md', 'src/index.ts'])).toBe(true)
  })

  it('空文件列表 → false', () => {
    expect(isWorkspaceCommit([])).toBe(false)
  })
})

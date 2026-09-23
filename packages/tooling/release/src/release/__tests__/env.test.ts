/**
 * 发版子进程的环境策略 + 凭据解析。
 *
 * 为什么这些用例重要：`git push` 会触发本仓自己的 pre-push 钩子，而钩子内容可以被一次提交改掉 ——
 * 「有合并权限的人」不该因此被放大成「有发版机凭据的人」。策略是**剥掉**而不是 `--no-verify`。
 */

import type { ReleaseArgs } from '../args.ts'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseReleaseArgs } from '../args.ts'
import { resolveToken } from '../credentials.ts'

const ORIGINAL_GITHUB_TOKEN = process.env.GITHUB_TOKEN
const ORIGINAL_GH_TOKEN = process.env.GH_TOKEN
const ORIGINAL_MARKER = process.env.WALNUT_TEST_MARKER

function restoreEnv(name: string, original: string | undefined): void {
  if (original === undefined)
    delete process.env[name]
  else
    process.env[name] = original
}

/** 用生产代码拿一份默认 args，再按需覆盖（避免在用例里抄一份参数表） */
function argsWith(overrides: Partial<ReleaseArgs> = {}): ReleaseArgs {
  const parsed = parseReleaseArgs([])
  if (!parsed.ok)
    throw new Error(`默认参数应当解析成功：${parsed.message}`)
  return { ...parsed.args, ...overrides }
}

afterEach(() => {
  restoreEnv('GITHUB_TOKEN', ORIGINAL_GITHUB_TOKEN)
  restoreEnv('GH_TOKEN', ORIGINAL_GH_TOKEN)
  restoreEnv('WALNUT_TEST_MARKER', ORIGINAL_MARKER)
  vi.resetModules()
})

describe('子进程环境 RELEASE_CHILD_ENV —— 每个子进程统一从这里取环境', () => {
  it('剥掉全部凭据变量、强制 GIT_TERMINAL_PROMPT=0，且不是 process.env 本身', async () => {
    // 先设进 process.env 再动态 import：模块加载时就会做一次 sanitizeEnv
    process.env.GITHUB_TOKEN = 'ghp_dummy_token_that_must_be_stripped'
    process.env.GH_TOKEN = 'ghp_dummy_gh_token_that_must_be_stripped'
    vi.resetModules()
    const { RELEASE_CHILD_ENV, RELEASE_CHILD_ENV_SECRETS } = await import('../env.ts')

    expect([...RELEASE_CHILD_ENV_SECRETS]).toEqual(['GITHUB_TOKEN', 'GH_TOKEN'])
    for (const name of RELEASE_CHILD_ENV_SECRETS) {
      expect(process.env[name], `前提：${name} 应当已经设在 process.env 里`).toBeDefined()
      expect(RELEASE_CHILD_ENV[name], `${name} 绝不能进任何子进程（钩子内容可被一次提交改掉）`).toBeUndefined()
    }
    expect(RELEASE_CHILD_ENV.GIT_TERMINAL_PROMPT).toBe('0')
    expect(RELEASE_CHILD_ENV).not.toBe(process.env)
  })

  it('是 process.env 的克隆：非凭据变量照旧带过去', async () => {
    process.env.WALNUT_TEST_MARKER = 'keep-me'
    vi.resetModules()
    const { RELEASE_CHILD_ENV } = await import('../env.ts')
    expect(RELEASE_CHILD_ENV.WALNUT_TEST_MARKER).toBe('keep-me')
  })

  it('源对象不被就地改动（删掉的是克隆里那一份）', async () => {
    process.env.GITHUB_TOKEN = 'ghp_still_here_after_sanitize'
    vi.resetModules()
    const { RELEASE_CHILD_ENV } = await import('../env.ts')
    expect(RELEASE_CHILD_ENV.GITHUB_TOKEN).toBeUndefined()
    expect(process.env.GITHUB_TOKEN).toBe('ghp_still_here_after_sanitize')
  })
})

describe('resolveToken —— 来源顺序 `--token` > `GITHUB_TOKEN` > 无', () => {
  it('--token 赢过环境变量，source 记作 --token', () => {
    process.env.GITHUB_TOKEN = 'ghp_from_environment'
    expect(resolveToken(argsWith({ token: 'ghp_from_flag' }))).toEqual({ token: 'ghp_from_flag', source: '--token' })
  })

  it('没有 --token 时用 GITHUB_TOKEN，source 记作 GITHUB_TOKEN', () => {
    process.env.GITHUB_TOKEN = 'ghp_from_environment'
    expect(resolveToken(argsWith())).toEqual({ token: 'ghp_from_environment', source: 'GITHUB_TOKEN' })
  })

  it('环境变量首尾空白被 trim；只有空白等于没给', () => {
    process.env.GITHUB_TOKEN = '  ghp_padded  '
    expect(resolveToken(argsWith())).toEqual({ token: 'ghp_padded', source: 'GITHUB_TOKEN' })

    process.env.GITHUB_TOKEN = '   '
    expect(resolveToken(argsWith())).toEqual({ token: null, source: null })
  })

  it('两者都没有 ⇒ { token: null, source: null }（不是错误，公开仓匿名可用）', () => {
    delete process.env.GITHUB_TOKEN
    expect(resolveToken(argsWith())).toEqual({ token: null, source: null })
  })
})

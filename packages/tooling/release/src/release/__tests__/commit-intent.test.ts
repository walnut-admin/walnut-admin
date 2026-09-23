/**
 * 约定式提交 → 变更意图的分类规则（纯逻辑）。
 *
 * 判据来自 commit-intent.ts 的注释：能进 changelog / 能触发版本升级的就是那五类，其余一律 skip；
 * `!` 记作 breaking ⇒ major。本套用例是「与 @walnut/commitlint-config 同口径」那条承诺的机械拦网。
 */

import type { ParsedCommit } from '../commit-intent.ts'
import { describe, expect, it } from 'vitest'
import { BREAKING_BUMP, buildIntentSummary, BUMP_MAP, getBump, hashesInIntentBodies, hashFromIntentBody, isNoise, parseCommit } from '../commit-intent.ts'

/** 解析一条提交；解析不出来即用例失败 */
function parsed(subject: string, hash = '1a82770'): ParsedCommit {
  const result = parseCommit(hash, subject)
  if (!result)
    throw new Error(`期望解析出 commit，实际返回 null：${JSON.stringify(subject)}`)
  return result
}

describe('bUMP_MAP —— 与 commitlint 的 type-enum 同口径', () => {
  it('内容逐个钉住（多一个少一个都算漂移）', () => {
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

  it('破坏性变更按 major（与 release.md / commitlint 记的 breaking 一致）', () => {
    expect(BREAKING_BUMP).toBe('major')
  })
})

describe('isNoise —— 太短 / 纯数字 / 草稿形态', () => {
  it('短于 4 字符的串一律是噪声', () => {
    expect(isNoise('')).toBe(true)
    expect(isNoise('a')).toBe(true)
    expect(isNoise('abc')).toBe(true)
    expect(isNoise('  ab  ')).toBe(true)
    expect(isNoise('abcd')).toBe(false)
  })

  it('纯数字 / 版本号形态（1、6.4、0527）是噪声', () => {
    expect(isNoise('1')).toBe(true)
    expect(isNoise('1234')).toBe(true)
    expect(isNoise('6.4')).toBe(true)
    expect(isNoise('0527')).toBe(true)
    expect(isNoise('1.2.3.4')).toBe(true)
    expect(isNoise('1a2b')).toBe(false)
  })

  it('wip: / fixup! / squash! / tmp / draft 是噪声', () => {
    expect(isNoise('wip: 临时提交')).toBe(true)
    expect(isNoise('WIP: 临时提交')).toBe(true)
    expect(isNoise('fixup! feat(admin): x')).toBe(true)
    expect(isNoise('squash! feat(admin): x')).toBe(true)
    expect(isNoise('tmp')).toBe(true)
    expect(isNoise('tmp 占位')).toBe(true)
    expect(isNoise('draft 一版')).toBe(true)
    expect(isNoise('feat: 真提交')).toBe(false)
  })
})

describe('parseCommit —— 约定式与非约定式输入', () => {
  it('带 scope 的形态', () => {
    expect(parsed('feat(admin): 支持记住登录状态')).toEqual({
      hash: '1a82770',
      type: 'feat',
      scope: 'admin',
      breaking: false,
      summary: '支持记住登录状态',
    })
  })

  it('不带 scope 的形态', () => {
    expect(parsed('fix: 修掉分页')).toEqual({
      hash: '1a82770',
      type: 'fix',
      scope: null,
      breaking: false,
      summary: '修掉分页',
    })
  })

  it('破坏性形态 `type(scope)!:` 与 `type!:`', () => {
    expect(parsed('feat(admin)!: 不再支持 IE')).toMatchObject({ type: 'feat', scope: 'admin', breaking: true, summary: '不再支持 IE' })
    expect(parsed('feat!: 大改')).toMatchObject({ type: 'feat', scope: null, breaking: true, summary: '大改' })
  })

  it('type 统一小写（`FEAT:` 也算 feat）', () => {
    expect(parsed('FEAT(admin): x').type).toBe('feat')
  })

  it('非约定式输入：type 为 null，但主题被保留（由调用方兜底为 patch）', () => {
    expect(parsed('随手改了点东西')).toEqual({
      hash: '1a82770',
      type: null,
      scope: null,
      breaking: false,
      summary: '随手改了点东西',
    })
  })

  it('空 hash / 空主题 / 噪声主题 ⇒ null', () => {
    expect(parseCommit('', 'feat(admin): x')).toBeNull()
    expect(parseCommit('1a82770', '')).toBeNull()
    expect(parseCommit('1a82770', 'wip: x')).toBeNull()
  })
})

describe('getBump —— 这条提交该发哪一档', () => {
  it('breaking ⇒ major（优先于 type）', () => {
    expect(getBump(parsed('fix(admin)!: 不兼容修复'))).toBe('major')
    expect(getBump(parsed('chore(admin)!: 不兼容杂务'))).toBe('major')
  })

  it('在册的五个可发版 type', () => {
    expect(getBump(parsed('feat(admin): x'))).toBe('minor')
    expect(getBump(parsed('fix(admin): x'))).toBe('patch')
    expect(getBump(parsed('perf(admin): x'))).toBe('patch')
    expect(getBump(parsed('refactor(admin): x'))).toBe('patch')
    expect(getBump(parsed('revert(admin): x'))).toBe('patch')
  })

  it('docs / chore / ci / test / build / style ⇒ skip', () => {
    for (const type of ['docs', 'chore', 'ci', 'test', 'build', 'style']) {
      expect(getBump(parsed(`${type}(admin): x`)), `${type} 不该触发发版`).toBe('skip')
    }
  })

  it('无前缀（type: null）与未在册的 type ⇒ patch（保证变异不丢失）', () => {
    expect(getBump(parsed('没有前缀的提交'))).toBe('patch')
    expect(getBump(parsed('perf2(admin): x'))).toBe('patch')
  })
})

describe('buildIntentSummary / hashFromIntentBody —— 幂等键往返', () => {
  it('形状 `<hash> ::: <type> ::: <scope: 主题>`', () => {
    expect(buildIntentSummary(parsed('feat(admin): 支持记住登录状态', '1a82770'))).toBe('1a82770 ::: feat ::: admin: 支持记住登录状态')
    expect(buildIntentSummary(parsed('fix: 修掉分页', 'abc1234'))).toBe('abc1234 ::: fix ::: 修掉分页')
  })

  it('无 type 时第一段写 other', () => {
    expect(buildIntentSummary(parsed('没有前缀的提交', '1a82770'))).toBe('1a82770 ::: other ::: 没有前缀的提交')
  })

  it('往返：生成的正文能被 hashFromIntentBody 读回同一个 hash', () => {
    for (const hash of ['1a82770', 'abc1234', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef']) {
      const body = buildIntentSummary(parsed('feat(admin): x', hash))
      expect(hashFromIntentBody(body)).toBe(hash)
    }
  })

  it('读不回来时返回 null（形状不对 / hash 位数不足）', () => {
    expect(hashFromIntentBody('随便一段话')).toBeNull()
    expect(hashFromIntentBody('1a827 ::: feat ::: 太短')).toBeNull()
    expect(hashFromIntentBody('zzzzzzz ::: feat ::: 不是十六进制')).toBeNull()
    expect(hashFromIntentBody('')).toBeNull()
  })

  it('hashesInIntentBodies 支持多行正文并去重', () => {
    const bodies = [
      '1a82770 ::: feat ::: admin: a\nabc1234 ::: fix ::: b',
      '1a82770 ::: feat ::: admin: a（重复）\ndeadbee ::: other ::: c',
      '没有 hash 的一行',
    ]
    expect(hashesInIntentBodies(bodies)).toEqual(new Set(['1a82770', 'abc1234', 'deadbee']))
    expect(hashesInIntentBodies([])).toEqual(new Set())
  })
})

/**
 * git ref 白名单（纯逻辑）。
 *
 * 为什么必须有它：ref 会作为 **argv** 传给 `git push origin <分支> <标签>`；
 * git 自己允许 ref 名含 `$ ( ) { } > "`，`..` 又能做路径上跳。校验失败一律 `PreconditionError`
 * （→ 退出码 2：输入没准备好，不是检出违规）。
 */

import { describe, expect, it } from 'vitest'
import { PreconditionError } from '../errors.ts'
import { assertSafeRef } from '../ref-guard.ts'

describe('assertSafeRef —— 接受合法 ref 并原样返回', () => {
  it('tag 形态 / 分支名 / 带后缀的分支名', () => {
    expect(assertSafeRef('v1.2.3', 'tag 名')).toBe('v1.2.3')
    expect(assertSafeRef('main', '分支名')).toBe('main')
    expect(assertSafeRef('v1.0.0-hotfix.2', 'tag 名')).toBe('v1.0.0-hotfix.2')
  })

  it('常见安全形态也放行（feature 分支、release 分支、大写）', () => {
    for (const value of ['feature/admin-login', 'release/1.2', 'HEAD', 'origin/main', 'v1.2.3_rc1'])
      expect(assertSafeRef(value, 'ref')).toBe(value)
  })
})

describe('assertSafeRef —— 逐条拒绝并给出人话理由', () => {
  const REJECTED: [value: string, reason: string][] = [
    ['', '空串'],
    ['-v1.2.3', '以 `-` 开头'],
    ['--force', '以 `-` 开头'],
    ['main branch', '空白字符'],
    ['main\tbranch', '空白字符'],
    ['main\nbranch', '空白字符'],
    ['a\u0000b', '控制字符'],
    ['a\u007Fb', '控制字符'],
    ['a..b', '`..`'],
    ['v1.2.3..v1.2.4', '`..`'],
    ['a@{b}', '`@{`'],
    ['v1.2.3.lock', '`.lock`'],
    ['v1.2.3.', '`.`'],
    ['a//b', '`//`'],
    ['a~b', 'git 保留字符'],
    ['a^b', 'git 保留字符'],
    ['a:b', 'git 保留字符'],
    ['a?b', 'git 保留字符'],
    ['a*b', 'git 保留字符'],
    ['a[b', 'git 保留字符'],
    ['a\\b', 'git 保留字符'],
  ]

  it.each(REJECTED)('拒绝 %j（理由含「%s」）', (value, reason) => {
    expect(() => assertSafeRef(value, 'ref')).toThrow(PreconditionError)
    expect(() => assertSafeRef(value, 'ref')).toThrow(reason)
  })

  it('报错文案带上「这是什么」（分支名 / tag 名）与被拒绝的值本身', () => {
    expect(() => assertSafeRef('-v9.9.9', '分支名')).toThrow(/分支名不能作为 git 参数/)
    expect(() => assertSafeRef('-v9.9.9', '分支名')).toThrow(/"-v9\.9\.9"/)
    expect(() => assertSafeRef('a b', 'tag 名')).toThrow(/tag 名不能作为 git 参数/)
  })

  it('抛出的是 PreconditionError（→ 退出码 2，不是 1）', () => {
    try {
      assertSafeRef('a..b', 'ref')
      throw new Error('应当抛错')
    }
    catch (error) {
      expect(error).toBeInstanceOf(PreconditionError)
      expect((error as PreconditionError).name).toBe('PreconditionError')
    }
  })
})

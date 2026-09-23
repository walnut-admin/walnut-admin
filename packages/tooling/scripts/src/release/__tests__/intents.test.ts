/**
 * 意图解析与版本算术（纯逻辑）。
 *
 * 判据来自 intents.ts 的注释：必须能切出 `---\n<frontmatter>\n---\n\n<summary>`；
 * 容忍 LF / CRLF、引号 / 裸包名、`./packages/xxx` 目录引用；`none` **不参与**取最大。
 */

import { describe, expect, it } from 'vitest'
import { allNone, nextVersion, parseFrontmatterLine, parseIntent } from '../intents.ts'

describe('nextVersion —— 判别式（不认识的输入返回 null，绝不猜）', () => {
  it('major / minor / patch 只做三个整数位的加法', () => {
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0')
    expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(nextVersion('0.0.0', 'major')).toBe('1.0.0')
    expect(nextVersion('0.0.1', 'minor')).toBe('0.1.0')
  })

  it('none 原样返回同一个版本（= 这次不发版）', () => {
    expect(nextVersion('1.2.3', 'none')).toBe('1.2.3')
    expect(nextVersion('0.0.1', 'none')).toBe('0.0.1')
  })

  it('prerelease / build 元数据返回 null（有人手工改了 manifest，应当响亮报错）', () => {
    expect(nextVersion('1.2.3-beta.1', 'patch')).toBeNull()
    expect(nextVersion('1.2.3+build.7', 'patch')).toBeNull()
    expect(nextVersion('1.2.3-rc.1+build', 'minor')).toBeNull()
  })

  it('`v` 前缀与垃圾输入返回 null', () => {
    expect(nextVersion('v1.2.3', 'patch')).toBeNull()
    expect(nextVersion('1.2', 'patch')).toBeNull()
    expect(nextVersion('1.2.3.4', 'patch')).toBeNull()
    expect(nextVersion('abc', 'patch')).toBeNull()
    expect(nextVersion('', 'patch')).toBeNull()
  })

  it('不安全整数返回 null；首尾空白被容忍', () => {
    expect(nextVersion('99999999999999999999.0.0', 'major')).toBeNull()
    expect(nextVersion('  1.2.3  ', 'patch')).toBe('1.2.4')
  })
})

describe('parseIntent —— 格式容忍', () => {
  it('双引号包名（pnpm change 的产物形态）', () => {
    const intent = parseIntent('auto-1a82770.md', '---\n"@walnut/admin": minor\n"@walnut/utils": patch\n---\n\n1a82770 ::: feat ::: admin: x\n')
    expect(intent).toEqual({
      file: 'auto-1a82770.md',
      packages: ['@walnut/admin', '@walnut/utils'],
      bump: 'minor',
      summary: '1a82770 ::: feat ::: admin: x',
    })
  })

  it('裸包名（手写意图）', () => {
    const intent = parseIntent('manual.md', '---\n@walnut/admin: patch\n---\n\n手写摘要\n')
    expect(intent?.packages).toEqual(['@walnut/admin'])
    expect(intent?.bump).toBe('patch')
    expect(intent?.summary).toBe('手写摘要')
  })

  it('./packages/x 目录引用（包名有歧义时 pnpm 会这么写）', () => {
    const intent = parseIntent('manual.md', '---\n"./packages/tooling/scripts": minor\n---\n\nbody\n')
    expect(intent?.packages).toEqual(['./packages/tooling/scripts'])
    expect(intent?.bump).toBe('minor')
  })

  it('cRLF 输入与 LF 输入解析结果一致', () => {
    const lf = parseIntent('a.md', '---\n"@walnut/admin": patch\n---\n\nbody\n')
    const crlf = parseIntent('a.md', '---\r\n"@walnut/admin": patch\r\n---\r\n\r\nbody\r\n')
    expect(crlf).toEqual(lf)
  })

  it('多包取最高档，包名保持出现顺序且去重', () => {
    const intent = parseIntent('a.md', [
      '---',
      '"@walnut/admin": patch',
      '"@walnut/utils": minor',
      '"@walnut/admin": patch',
      '"@walnut/http": patch',
      '---',
      '',
      '1a82770 ::: feat ::: x',
    ].join('\n'))
    expect(intent?.bump).toBe('minor')
    expect(intent?.packages).toEqual(['@walnut/admin', '@walnut/utils', '@walnut/http'])
  })

  it('none 不参与取最大：有别的档位时以那个为准', () => {
    const intent = parseIntent('a.md', '---\n"@walnut/admin": none\n"@walnut/utils": patch\n---\n\nbody\n')
    expect(intent?.bump).toBe('patch')
    expect(intent?.packages).toEqual(['@walnut/admin', '@walnut/utils'])
  })

  it('只有 none 条目 ⇒ 返回 null（maxBump 保持 null，不是「none 意图」）', () => {
    expect(parseIntent('a.md', '---\n"@walnut/admin": none\n---\n\nbody\n')).toBeNull()
    expect(parseIntent('a.md', '---\n"@walnut/admin": none\n"@walnut/utils": none\n---\n\nbody\n')).toBeNull()
  })

  it('没有 frontmatter / 没有包名 / 没有 bump 行 ⇒ null', () => {
    expect(parseIntent('a.md', 'not a changeset\n')).toBeNull()
    expect(parseIntent('a.md', '---\n---\n\nbody\n')).toBeNull()
    expect(parseIntent('a.md', '---\n"@walnut/admin": unknown-level\n---\n\nbody\n')).toBeNull()
  })

  it('摘要取 `---` 之后的正文并 trim；没有正文时是空串', () => {
    expect(parseIntent('a.md', '---\n"@walnut/admin": patch\n---\n\n\n  正文  \n\n')?.summary).toBe('正文')
    expect(parseIntent('a.md', '---\n"@walnut/admin": patch\n---')?.summary).toBe('')
    expect(parseIntent('a.md', '---\n"@walnut/admin": patch\n---\n\n')?.summary).toBe('')
  })

  it('只有 frontmatter、没有正文的意图**仍然算数**（摘要为空串）', () => {
    // 手写的无正文意图必须能解析：早先的正则要求 `---` 之后「要么空行 + 正文、要么行尾」，
    // 于是 `---\n<fm>\n---\n` 两条都不满足 ⇒ 返回 null ⇒ readIntents() 静默跳过它
    // ⇒ 用户以为写了、实际没进自动档位汇总。静默丢信息是本仓最要避免的形态。
    expect(parseIntent('a.md', '---\n"@walnut/admin": patch\n---\n')?.bump).toBe('patch')
    expect(parseIntent('a.md', '---\n"@walnut/admin": patch\n---\n')?.summary).toBe('')
  })
})

describe('parseFrontmatterLine —— name 与 prefix 的分工（改写的正确性全靠它）', () => {
  it('name 是**剥过引号**的名字，prefix 保留**原样**的引号', () => {
    // 这一对区别就是那个缺陷的修复点：
    //   · name 拿去当包名（`@walnut/admin`，不能带引号）
    //   · prefix 拿去重建行 —— 必须保留引号，否则 `@` 开头的 plain scalar 不是合法 YAML
    const entry = parseFrontmatterLine('"@walnut/admin": patch')
    expect(entry).toEqual({
      name: '@walnut/admin',
      prefix: '"@walnut/admin": ',
      bump: 'patch',
      suffix: '',
    })
    expect(entry?.prefix).toContain('"@walnut/admin"')
  })

  it('目录引用（"./packages/x"）同样只剥 name、不动 prefix', () => {
    expect(parseFrontmatterLine('"./packages/tooling/scripts": minor')).toEqual({
      name: './packages/tooling/scripts',
      prefix: '"./packages/tooling/scripts": ',
      bump: 'minor',
      suffix: '',
    })
  })

  it('裸名两侧都不加引号；逗号两侧空白原样保留在 prefix / suffix 里', () => {
    expect(parseFrontmatterLine('admin:   minor  ')).toEqual({
      name: 'admin',
      prefix: 'admin:   ',
      bump: 'minor',
      suffix: '  ',
    })
    expect(parseFrontmatterLine('  "a/b": patch')).toEqual({
      name: 'a/b',
      prefix: '  "a/b": ',
      bump: 'patch',
      suffix: '',
    })
  })

  it('读不出名字或档位的行返回 null（不是「空名字」）', () => {
    expect(parseFrontmatterLine('没有冒号的一行')).toBeNull()
    expect(parseFrontmatterLine(': patch')).toBeNull()
    expect(parseFrontmatterLine('"a"b": patch')).toBeNull()
    expect(parseFrontmatterLine('a:b: patch')).toBeNull()
    expect(parseFrontmatterLine('admin: two words')).toBeNull()
  })
})

describe('allNone —— 「明确声明本次不发版」', () => {
  it('空集不算全 none（没有意图 ≠ 声明不发版）', () => {
    expect(allNone([])).toBe(false)
  })

  it('全部 none ⇒ true；混入任何一档 ⇒ false', () => {
    const none = { file: 'a.md', packages: ['@walnut/admin'], bump: 'none' as const, summary: '' }
    const patch = { file: 'b.md', packages: ['@walnut/utils'], bump: 'patch' as const, summary: '' }
    expect(allNone([none, { ...none, file: 'c.md' }])).toBe(true)
    expect(allNone([none, patch])).toBe(false)
    expect(allNone([patch])).toBe(false)
  })
})

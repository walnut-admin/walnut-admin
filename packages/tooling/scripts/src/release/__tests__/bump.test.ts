/**
 * 升级级别汇总与意图 frontmatter 改写（纯逻辑）。
 *
 * 本模块的两个缺陷都有历史出处（见 bump.ts 注释）：`resolveAutoBump` 的 none 语义、
 * 以及 `overrideIntentBump` 只改第一行的旧写法 —— 后者用多包意图钉住。
 */

import type { Intent } from '../intents.ts'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { bumpChangesVersion, bumpLabel, overrideIntentBump, resolveAutoBump } from '../bump.ts'
import { parseIntent } from '../intents.ts'

function intent(bump: Intent['bump'], file = 'auto-1a82770.md'): Intent {
  return { file, packages: ['@walnut/admin'], bump, summary: '1a82770 ::: feat ::: admin: x' }
}

/** 一个提及三个包的意图（多包意图在本仓很常见：一条提交可命中多个包） */
const MULTI_PACKAGE_INTENT = [
  '---',
  '"@walnut/admin": patch',
  '"@walnut/utils": patch',
  '"@walnut/http": none',
  '---',
  '',
  '1a82770 ::: feat ::: admin: 支持记住登录状态',
  '',
  '正文里的 "@walnut/admin": patch 不属于 frontmatter，不该被动',
].join('\n')

/** frontmatter 段里每一行的档位（不依赖引号形态 —— 改写保证的是语义，不是字面量） */
function frontmatterBumps(content: string): string[] {
  const frontmatter = content.split('---')[1] ?? ''
  return frontmatter
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.slice(line.lastIndexOf(':') + 1).trim())
}

/** frontmatter 段里每一行的包名（剥掉成对引号） */
function frontmatterNames(content: string): string[] {
  const frontmatter = content.split('---')[1] ?? ''
  return frontmatter
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.slice(0, line.lastIndexOf(':')).trim().replace(/^["']|["']$/g, ''))
}

describe('resolveAutoBump —— 取所有意图里非 none 的最高档', () => {
  it('没有意图 ⇒ none', () => {
    expect(resolveAutoBump([])).toBe('none')
  })

  it('全部 none ⇒ none（= 明确声明本次不发版）', () => {
    expect(resolveAutoBump([intent('none'), intent('none', 'b.md')])).toBe('none')
  })

  it('混合集合取最高档，且 none 不影响结果', () => {
    expect(resolveAutoBump([intent('patch'), intent('minor', 'b.md')])).toBe('minor')
    expect(resolveAutoBump([intent('patch'), intent('major', 'b.md'), intent('minor', 'c.md')])).toBe('major')
    expect(resolveAutoBump([intent('none'), intent('patch', 'b.md'), intent('none', 'c.md')])).toBe('patch')
    expect(resolveAutoBump([intent('minor'), intent('patch', 'b.md')])).toBe('minor')
  })
})

describe('bumpChangesVersion / bumpLabel', () => {
  it('只有 none 不改版本号', () => {
    expect(bumpChangesVersion('none')).toBe(false)
    expect(bumpChangesVersion('patch')).toBe(true)
    expect(bumpChangesVersion('minor')).toBe(true)
    expect(bumpChangesVersion('major')).toBe(true)
  })

  it('none 的人类标签说清「不发版」', () => {
    expect(bumpLabel('none')).toBe('none（不发版）')
    expect(bumpLabel('major')).toBe('major')
  })
})

describe('overrideIntentBump —— 必须改**全部**包行', () => {
  it('多包意图的每一行都被改写成目标档位（旧实现只改第一行）', () => {
    const result = overrideIntentBump(MULTI_PACKAGE_INTENT, 'minor')
    expect(result.changed).toBe(3)

    // 逐行断言「每一行都不再是原档」——这正是缺陷的形态本身
    expect(frontmatterNames(result.content)).toEqual(['@walnut/admin', '@walnut/utils', '@walnut/http'])
    expect(frontmatterBumps(result.content)).toEqual(['minor', 'minor', 'minor'])
    // 三行都必须真的变了（不是靠最后一行撑起最大档）
    expect(frontmatterBumps(MULTI_PACKAGE_INTENT)).toEqual(['patch', 'patch', 'none'])
  })

  it('改写后的 frontmatter 能被解析回同一个包集合与新档位', () => {
    const result = overrideIntentBump(MULTI_PACKAGE_INTENT, 'major')
    const reparsed = parseIntent('auto-1a82770.md', result.content)
    expect(reparsed?.packages).toEqual(['@walnut/admin', '@walnut/utils', '@walnut/http'])
    expect(reparsed?.bump).toBe('major')
    // 正文（含第二段）原样保留
    expect(reparsed?.summary).toContain('1a82770 ::: feat ::: admin: 支持记住登录状态')
    expect(reparsed?.summary).toContain('正文里的 "@walnut/admin": patch 不属于 frontmatter，不该被动')
  })

  it('正文里的同形文字不动（只改 frontmatter 段）', () => {
    const result = overrideIntentBump(MULTI_PACKAGE_INTENT, 'major')
    expect(result.content).toContain('正文里的 "@walnut/admin": patch 不属于 frontmatter，不该被动')
    expect(result.content).toContain('1a82770 ::: feat ::: admin: 支持记住登录状态')
    // 正文里的 `"@walnut/admin": patch` 后面没有 ':' 之外的档位改写痕迹
    expect(result.content.split('---').slice(2).join('---')).toContain('"@walnut/admin": patch')
  })

  it('已经在目标档位 ⇒ changed: 0 且内容原样返回', () => {
    const already = ['---', '"@walnut/admin": patch', '"@walnut/utils": patch', '---', '', 'body', ''].join('\n')
    expect(overrideIntentBump(already, 'patch')).toEqual({ content: already, changed: 0 })
  })

  it('只有需要改的行计入 changed', () => {
    const mixed = ['---', '"@walnut/admin": patch', '"@walnut/utils": minor', '---', '', 'body', ''].join('\n')
    const result = overrideIntentBump(mixed, 'minor')
    expect(result.changed).toBe(1)
    expect(frontmatterBumps(result.content)).toEqual(['minor', 'minor'])
    expect(frontmatterNames(result.content)).toEqual(['@walnut/admin', '@walnut/utils'])
  })

  it('改写后的 frontmatter 仍然是合法 YAML（pnpm 是按 YAML 读它的）', () => {
    // 意图文件的 frontmatter 就是 YAML；改写只是为了让 pnpm 换一档消费它，
    // 写出一份 YAML 解析器读不了的文件等于把用户选的档位丢掉。
    // `@` 是 YAML 的保留指示符，**不能**做 plain scalar 的首字符 —— scoped 包名必须带引号。
    const frontmatter = overrideIntentBump(MULTI_PACKAGE_INTENT, 'minor').content.split('---')[1] ?? ''
    expect(
      () => parseYaml(frontmatter),
      `改写后的 frontmatter 不再是合法 YAML（scoped 包名必须带引号）：\n${frontmatter}`,
    ).not.toThrow()
    expect(parseYaml(frontmatter)).toEqual({
      '@walnut/admin': 'minor',
      '@walnut/utils': 'minor',
      '@walnut/http': 'minor',
    })
  })

  it('改写保留包名原有的引号形态（scoped 包名必须带引号才是合法 YAML）', () => {
    const quoted = overrideIntentBump(MULTI_PACKAGE_INTENT, 'minor')
    for (const line of ['"@walnut/admin": minor', '"@walnut/utils": minor', '"@walnut/http": minor'])
      expect(quoted.content, `这一行丢了引号：${line}`).toContain(line)

    // 裸名（本来就没有引号）也不该被加上引号
    const bare = ['---', 'admin: patch', '---', '', 'body', ''].join('\n')
    const rewritten = overrideIntentBump(bare, 'minor')
    expect(rewritten.content).toContain('admin: minor')
    expect(rewritten.content).not.toContain('"admin"')
    expect(parseYaml(rewritten.content.split('---')[1] ?? '')).toEqual({ admin: 'minor' })
  })

  it('没有 frontmatter ⇒ changed: 0 且内容逐字不变', () => {
    expect(overrideIntentBump('plain text', 'major')).toEqual({ content: 'plain text', changed: 0 })
  })

  it('crlf 输入被规范化成 LF（改写过的情况）', () => {
    const crlf = '---\r\n"@walnut/admin": patch\r\n---\r\n\r\nbody\r\n'
    const result = overrideIntentBump(crlf, 'minor')
    expect(result.changed).toBe(1)
    expect(result.content).not.toContain('\r')
    expect(frontmatterBumps(result.content)).toEqual(['minor'])
    expect(frontmatterNames(result.content)).toEqual(['@walnut/admin'])
  })
})

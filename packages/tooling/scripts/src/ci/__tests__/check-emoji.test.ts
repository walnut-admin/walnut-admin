/**
 * `check-emoji.ts` 的用例。
 *
 * 两类重点：① **分派正确**（哪些文件扫注释、哪些走严格档、哪些不扫）—— 分派错了要么漏、要么噪声；
 * ② **不误伤**（`©` `®` `™` 与排版符号 `→` `⇒` `≤` 不算 emoji）—— 实测真误伤过：JSDoc 里的
 * `@default Copyright © …` 被删，随仓库提交的生成物 schema 跟着漂移。
 *
 * 另外那条「本仓当前干净」会在将来有人写进 emoji 时先红。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { EMOJI_CHAR, findEmoji, stripEmoji } from '../../lib/emoji.ts'
import { checkFile, collectFindings, isComment, isStrictDoc, listCandidateFiles, syntaxOf } from '../check-emoji.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url))

/** 造一个临时"仓库根"并写入指定文件 */
function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'walnut-emoji-'))
  roots.push(root)
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(root, name), content)
  return root
}

describe('注释语法分派', () => {
  it('按扩展名给出语法：yml/toml/sh/conf 走 #，ts/vue 走行注释，json 与 md 不扫', () => {
    expect(syntaxOf('.github/workflows/ci.yml')).toBe('hash')
    expect(syntaxOf('cliff.toml')).toBe('hash')
    expect(syntaxOf('deploy/nginx/conf.d/frontend.conf')).toBe('hash')
    expect(syntaxOf('apps/admin/src/main.ts')).toBe('slash')
    expect(syntaxOf('apps/admin/src/App.vue')).toBe('slash')
    expect(syntaxOf('package.json')).toBe('none')
    expect(syntaxOf('apps/docs/src/zh-CN/index.md')).toBe('none')
  })

  it('没有扩展名的白名单文件按 # 处理（.gitignore / Dockerfile）', () => {
    expect(syntaxOf('.gitignore')).toBe('hash')
    expect(syntaxOf('Dockerfile')).toBe('hash')
    expect(syntaxOf('LICENSE')).toBe('none')
  })

  it('注释判定：字符串行不算注释（CLI 图标、用例断言都在字符串里，那些是刻意的）', () => {
    expect(isComment('# 注释', 'hash')).toBe(true)
    expect(isComment('key: value # 行尾', 'hash')).toBe(false) // 只认整行注释，宁可漏报不误报
    expect(isComment('// 注释', 'slash')).toBe(true)
    expect(isComment(' * 块注释续行', 'slash')).toBe(true)
    expect(isComment('const ok = \'✅\'', 'slash')).toBe(false)
  })

  it('常驻上下文文档走严格档（复用文档预算那份名单，不写第二份）', () => {
    expect(isStrictDoc('AGENTS.md')).toBe(true)
    expect(isStrictDoc('apps/server/AGENTS.md')).toBe(true)
    expect(isStrictDoc('apps/docs/src/zh-CN/index.md')).toBe(false)
    expect(isStrictDoc('apps/docs/src/zh-CN/content/monorepo/release.md')).toBe(false)
  })
})

describe('扫描范围（真实仓库）', () => {
  it('覆盖 ESLint 够不着的那些文件，且不把文档站正文卷进来', () => {
    const files = listCandidateFiles(REPO_ROOT)
    expect(files).toContain('.github/workflows/ci.yml')
    expect(files).toContain('.gitignore')
    expect(files).toContain('lefthook.yml')
    expect(files).toContain('AGENTS.md') // 严格档
    // 文档站正文不在范围内（发布电池表里那些被用例逐字断言的标记要留着）
    expect(files).not.toContain('apps/docs/src/zh-CN/content/monorepo/release.md')
  })

  it('本仓当前干净（有人写进 emoji 时这条先红）', () => {
    expect(collectFindings(REPO_ROOT)).toEqual([])
  })
})

describe('判定与剔除', () => {
  it('emoji 命中；© ® ™ 与排版符号不命中', () => {
    expect(EMOJI_CHAR.test('⚠')).toBe(true)
    expect(EMOJI_CHAR.test('©')).toBe(false) // 手写区块不含 U+00A9，所以本就不算（豁免是双保险）
    expect(findEmoji('/** @default Copyright © 2020 Walnut Admin. */')).toEqual([])
    expect(findEmoji('// 品牌 ® 与 ™ 不算')).toEqual([])
    // 排版箭头与数学算子也不算 —— 判定面刻意比 \p{Extended_Pictographic} 窄
    expect(findEmoji('// A ↔ B → C ⇒ D，≤ 5')).toEqual([])
    expect(findEmoji('// 注意 ⚠ 这里')).toHaveLength(1)
  })

  it('剔除时顺带吃掉相邻的一个空格（不留双空格）', () => {
    expect(stripEmoji('// 甲 ⚠️ 乙')).toBe('// 甲 乙')
    expect(stripEmoji('// 行尾 🚀')).toBe('// 行尾')
    expect(stripEmoji('# 命令会静默丢参、还照样报 ✓')).toBe('# 命令会静默丢参、还照样报')
    expect(stripEmoji('/** @default Copyright © 2020 */')).toBe('/** @default Copyright © 2020 */')
  })
})

describe('checkFile —— 反例（两类文件各一条）', () => {
  it('配置文件注释里的 emoji（ESLint 覆盖面之外的那些就是这样漏的）', () => {
    const root = makeRepo({ 'ci.yml': 'name: CI\n# 注意 ⚠️ 这里\nsteps: []\n' })
    const findings = checkFile(root, 'ci.yml', false)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ file: 'ci.yml', line: 2, strict: false })
  })

  it('常驻文档里非注释位置的 emoji 也报（严格档）', () => {
    const root = makeRepo({ 'AGENTS.md': '# 标题 ✅\n\n正文里的 ⚠️ 也报\n' })
    const findings = checkFile(root, 'AGENTS.md', false)
    expect(findings.map(f => f.line)).toEqual([1, 3])
    expect(findings.every(f => f.strict)).toBe(true)
  })

  it('--fix 就地剔除，且只动命中的文件', () => {
    const root = makeRepo({ 'a.ts': '// 甲 ⚠️ 乙\n', 'b.ts': '// 干净\n' })
    expect(checkFile(root, 'a.ts', true)).toHaveLength(1)
    expect(checkFile(root, 'a.ts', false)).toEqual([])
    expect(checkFile(root, 'b.ts', false)).toEqual([])
  })
})

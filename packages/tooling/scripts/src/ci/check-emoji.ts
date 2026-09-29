/**
 * `pnpm lint:emoji` —— 注释里不许有 emoji（纯文字），跨**所有被跟踪的文本文件**。
 *
 * ## 为什么需要它（ESLint 那条规则不够）
 *
 * `@walnut/eslint-config` 里已经有 `walnut-comment/no-emoji`，但它只管 ESLint 能 lint 的文件。
 * 实测漏掉的 20 处全在覆盖面之外：`.github/workflows/*.yml`、`.gitignore`、`cliff.toml`、
 * `deploy/nginx/*.conf`、`lefthook.yml` —— 而根级 `lint:root` 只扫根目录的 `*.ts *.json *.yaml`。
 *
 * ## 判据分两档
 *
 * 1. **注释**（默认档）：按扩展名分派注释语法（`#` / 行注释 / 块注释 / HTML 注释），只查注释 ——
 *    字符串里的 emoji **不管**（CLI 输出图标、用例里对文档的逐字断言都在字符串里，那些是刻意的）。
 * 2. **常驻上下文文档**（严格档）：根 `AGENTS.md` / `CLAUDE.md` 与各 app 的指引 —— 它们**每次会话
 *    都要进上下文**，所以那些文件里**任何位置**的 emoji 都报（清单直接复用文档预算那份，避免两份名单）。
 *
 * 文档站正文与归档**刻意不管**：那是给读者看的参考资料，不是注释；而且发布电池表里有被用例
 * 逐字断言的标记（改了要同步改用例）。
 *
 * `--fix` 可直接剔除（含相邻空格），所以存量一条命令清干净。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { findEmoji, stripEmoji } from '../lib/emoji.ts'
import { ViolationError } from '../lib/errors.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { DOC_BUDGETS } from './check-doc-budgets.ts'

/** 注释语法分派：按扩展名给出注释行的判定 */
export type CommentSyntax = 'hash' | 'slash' | 'markup' | 'none'

/** 各扩展名用哪种注释语法（没列到的扩展名一律不扫） */
const SYNTAX_BY_EXT: Record<string, CommentSyntax> = {
  '.ts': 'slash',
  '.tsx': 'slash',
  '.js': 'slash',
  '.jsx': 'slash',
  '.vue': 'slash', // SFC 里行注释与块注释都存在；HTML 注释那档由 isComment 一并认
  '.json': 'none', // JSON 没有注释
  '.jsonc': 'slash',
  '.yml': 'hash',
  '.yaml': 'hash',
  '.toml': 'hash',
  '.sh': 'hash',
  '.bash': 'hash',
  '.zsh': 'hash',
  '.conf': 'hash',
  '.gitignore': 'hash',
  '.editorconfig': 'hash',
  '.properties': 'hash',
  '.md': 'none', // 正文另有严格档（常驻文档），这里不按注释处理
}

/** 没有扩展名但也按 `#` 注释处理的白名单文件 */
const HASH_COMMENT_FILES = new Set(['.gitignore', '.gitattributes', '.editorconfig', 'Dockerfile'])

/** 取扩展名（含 `.gitignore` 这种"整名当扩展名"的情形） */
function extOf(file: string): string {
  const base = file.split('/').pop() ?? file
  const dot = base.indexOf('.')
  if (dot <= 0)
    return base === 'Dockerfile' ? '.dockerfile' : ''
  return base.slice(dot).toLowerCase()
}

export function syntaxOf(file: string): CommentSyntax {
  if (HASH_COMMENT_FILES.has(file.split('/').pop() ?? file))
    return 'hash'
  const ext = extOf(file)
  return SYNTAX_BY_EXT[ext] ?? 'none'
}

/** 一行是不是注释（按语法分派；`slash` 也认块注释的续行与 `<!-- -->`） */
export function isComment(line: string, syntax: CommentSyntax): boolean {
  const t = line.trim()
  switch (syntax) {
    case 'hash':
      return t.startsWith('#')
    case 'slash':
      return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--')
    case 'markup':
      return t.startsWith('<!--')
    default:
      return false
  }
}

/** 常驻上下文文档：这些文件里**任何** emoji 都报（不只是注释） */
export function isStrictDoc(file: string): boolean {
  return DOC_BUDGETS.some(b => b.file === file)
}

/** 被跟踪的文本文件清单（只取有注释语法的那些；`git ls-files` 天然排除 gitignore 掉的东西） */
export function listCandidateFiles(repoRoot: string): string[] {
  const outText = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
  return outText
    .split('\0')
    .filter(Boolean)
    .filter(f => isStrictDoc(f) || syntaxOf(f) !== 'none')
    .sort()
}

export interface EmojiFinding {
  file: string
  line: number
  chars: string
  /** true = 命中的是"常驻上下文文档"（严格档） */
  strict: boolean
}

/** 扫一个文件（返回 findings；`fix` 为真时顺带就地写回） */
export function checkFile(repoRoot: string, file: string, fix: boolean): EmojiFinding[] {
  const path = join(repoRoot, file)
  const text = readFileSync(path, 'utf8')

  if (isStrictDoc(file)) {
    const hits = findEmoji(text).map(h => ({ file, line: h.line, chars: h.chars, strict: true }))
    if (fix && hits.length > 0)
      writeFileSync(path, stripEmoji(text))
    return hits
  }

  const syntax = syntaxOf(file)
  const findings: EmojiFinding[] = []
  const lines = text.split(/\r?\n/)
  for (const [index, src] of lines.entries()) {
    if (!isComment(src, syntax))
      continue
    for (const hit of findEmoji(src))
      findings.push({ file, line: index + 1, chars: hit.chars, strict: false })
  }
  if (fix && findings.length > 0)
    writeFileSync(path, stripEmoji(text))
  return findings
}

/** 全仓扫描（供门禁与用例共用） */
export function collectFindings(repoRoot: string, fix = false): EmojiFinding[] {
  const findings: EmojiFinding[] = []
  for (const file of listCandidateFiles(repoRoot))
    findings.push(...checkFile(repoRoot, file, fix))
  return findings
}

export function main(): void {
  const repoRoot = process.cwd()
  const fix = process.argv.includes('--fix')
  const files = listCandidateFiles(repoRoot)
  const strict = files.filter(isStrictDoc).length

  out(`emoji 检查：${files.length} 个被跟踪的文本文件（其中常驻上下文文档 ${strict} 个走严格档）${fix ? '，--fix 已开启' : ''}`)

  const findings = collectFindings(repoRoot, fix)
  if (findings.length === 0) {
    line('ok', '注释与常驻文档里没有 emoji（纯文字）')
    return
  }

  for (const f of findings.slice(0, 40))
    lineErr('violation', `${f.file}:${f.line}${f.strict ? '（常驻文档，任意位置）' : ''}  ${f.chars}`)
  if (findings.length > 40)
    err(`… 另有 ${findings.length - 40} 处`)

  if (fix) {
    line('ok', `已剔除 ${findings.length} 处 emoji（含相邻空格）`)
    return
  }
  err('\n它们在非 UTF-8 代码页的终端里会显示成乱码（中文有稳定双字节表示、emoji 没有），也会污染 diff 与日志。')
  err('修法：`pnpm lint:emoji --fix`（排版符号 → ⇒ ≤ 与 © ® ™ 不受影响）。')
  throw new ViolationError(`注释/常驻文档里有 ${findings.length} 处 emoji（明细见上）`)
}

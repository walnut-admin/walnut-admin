/**
 * ADR 形态校验：`content/adr/NNNN-*.md` 必须满足**统一形状**。
 *
 * 为什么要有它（2026-09-23，待办 F6 落地时实测的现状）：
 * - 19 篇 ADR 的 `**Status:**` 有**三种互不兼容**的取值：`Accepted` ×12、`Implemented` ×4、
 *   `In Progress — Phase 1 + 2 完成…` ×1。`Implemented` 是**范畴错误** —— ADR 记的是「这个决策
 *   现在算不算数」，不是「代码写完没有」；后者属于正文的 `## Implementation Progress`。
 * - 「备选方案」的记法有四种：独立小节（无）、`## Context` 里的粗体表（0002）、
 *   `## Decision` 里逐个子决策各一段（0011 / 0012 / 0014）、以及散在正文里的「为什么不…」段落
 *   （0019）。等于**没有约定**，读者无法回答「当时还考虑过什么」。
 *
 * 本门禁把这两件事变成机械判据。**只查形态，不查内容质量** —— 「备选写得有没有道理」是评审的活，
 * 机械检查拦不住，硬拦只会逼出凑格式的空话。
 *
 * 判据（每条都对应一次真实踩坑或一次明确约定）：
 *   ① 文件名 `NNNN-<kebab-slug>.md`，且**编号从 0001 起连续**、不重号；
 *   ② 首行 `# ADR-NNNN: <title>` 的编号与文件名一致；
 *   ③ 有 `**Date:** YYYY-MM-DD`；
 *   ④ 有 `**Status:** <枚举值>`，枚举见 `ADR_STATUSES`；`Superseded by ADR-NNNN` 的目标必须存在；
 *   ⑤ 必需小节：`## Context`、至少一个 `## Decision*`、**恰好一个** `## Alternatives considered`、
 *      `## Consequences`；
 *   ⑥ `## Alternatives considered` 必须排在**第一个 `## Decision` 之后**，且至少一条 `- ` 列表项。
 *      ⚠️ 刻意**不**约束它与 `## Consequences` 的先后：ADR 0012 的 `## Consequences` 在正文中间
 *      （Decision 4 之后还有 Decision 5/6/7），硬约束顺序会把它判死 —— 那是篇真实的 ADR，
 *      不是笔误。
 *   ⑦ `adr/index.md` 的表格**双向**对得上：每篇 ADR 都有一行，每行的链接都指向存在的文件，
 *      且行里的状态列与该文件的 `**Status:**` 一致。
 */

import fs from 'node:fs'
import path from 'node:path'
import { lsFilesWithUntracked } from '../lib/git.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** ADR 目录（仓库相对）。`index.md` 与 `zod-evaluation.md` 是站点页面，不是 ADR。 */
export const ADR_DIR = 'apps/docs/src/zh-CN/content/adr'

/**
 * `**Status:**` 的**全部**合法取值。
 *
 * 刻意只有四个：`Implemented` / `In Progress` 这类「实现进度」不属于这里 —— 那是正文的事。
 * 真需要表达「部分落地」，写在 `## Implementation Progress` 或 `## Consequences` 里。
 */
export const ADR_STATUSES = ['Proposed', 'Accepted', 'Rejected'] as const

/** `Superseded by ADR-NNNN` 单独判，因为要拿 NNNN 去查目标是否存在 */
const SUPERSEDED_PREFIX = 'Superseded by ADR-'

/** 不是 ADR 的站点页面（同目录但无编号） */
const NON_ADR_FILES = new Set(['index.md', 'zod-evaluation.md'])

export interface AdrFinding {
  /** 出问题的文件（仓库相对路径；index.md 的问题记在 index.md 上） */
  file: string
  /** 一句话判据说明 */
  problem: string
}

export interface AdrInput {
  /** ADR 正文件列表（仓库相对路径，可含非 ADR 页面，函数内部会筛掉） */
  files: string[]
  /** `adr/index.md` 的正文 */
  indexText: string
  readText: (file: string) => string
}

interface Heading {
  title: string
  offset: number
}

/**
 * 抽出二级标题（只看 `## `，`### ` 是子标题、不参与判据）。
 *
 * 正则刻意写成 `^##(.*)$` 而不是 `^##[ \t]+(.+?)[ \t]*$`：后者的 `[ \t]+` 与 `.+?` 能互相吞掉
 * 空白，是可被构造成多项式回溯的形状（`regexp/no-super-linear-backtracking` 会拦下来）。
 * 代价是 `###` / `####` 也会被匹配到 —— 它们的标题以 `#` 开头，显式跳过即可。
 */
export function headingsOf(text: string): Heading[] {
  const out: Heading[] = []
  const re = /^##(.*)$/gm
  let match = re.exec(text)
  while (match !== null) {
    const title = (match[1] ?? '').trim()
    if (title !== '' && !title.startsWith('#'))
      out.push({ title, offset: match.index })
    match = re.exec(text)
  }
  return out
}

/** `**Status:**` 的值；没有该行返回 null */
export function statusOf(text: string): string | null {
  const match = /^\*\*Status:\*\*(.*)$/m.exec(text)
  return match ? (match[1] ?? '').trim() : null
}

/** `**Date:**` 的值；没有该行返回 null */
export function dateOf(text: string): string | null {
  const match = /^\*\*Date:\*\*(.*)$/m.exec(text)
  return match ? (match[1] ?? '').trim() : null
}

/** 编号 → 仓库相对路径 */
function numberToFile(files: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const file of files) {
    const match = /(?:^|\/)(\d{4})-[^/]+\.md$/.exec(file)
    if (match)
      out.set(match[1] ?? '', file)
  }
  return out
}

/**
 * 解析 `index.md` 的表格行（`| [0001](./0001-x.md) | 决策 | Accepted |`）。
 *
 * 按 `|` 切列而不是写一条大正则：表格正则里的 `\s*` 与 `[^|]*` 能互相吞空白，属于
 * `regexp/no-super-linear-backtracking` 要拦的形状；切列没有回溯，也更好读。
 * 表头分隔行（`|-----|`）与其它表格会被第一列的链接形态自然筛掉。
 */
export function indexRowsOf(text: string): Array<{ number: string, target: string, status: string }> {
  const out: Array<{ number: string, target: string, status: string }> = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|'))
      continue
    // `| a | b | c |`.split('|') → ['', ' a ', ' b ', ' c ', '']，首尾是空串
    const cells = trimmed.split('|').map(cell => cell.trim())
    const link = /^\[(\d{4})\]\(\.\/([^)]+)\)$/.exec(cells[1] ?? '')
    if (link)
      out.push({ number: link[1] ?? '', target: link[2] ?? '', status: cells[3] ?? '' })
  }
  return out
}

export function collectFindings(input: AdrInput): AdrFinding[] {
  const findings: AdrFinding[] = []
  const adrFiles = input.files
    .filter(file => file.startsWith(`${ADR_DIR}/`) && !NON_ADR_FILES.has(path.posix.basename(file)))
    .sort()

  if (adrFiles.length === 0) {
    findings.push({ file: ADR_DIR, problem: '一篇 ADR 都没扫到 —— 拒绝把「扫不到东西」当绿灯' })
    return findings
  }

  // ① 文件名形态 + 编号连续
  const numbers: string[] = []
  for (const file of adrFiles) {
    const base = path.posix.basename(file)
    const match = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(base)
    if (!match) {
      findings.push({ file, problem: '文件名不是 `NNNN-<kebab-slug>.md` 形态' })
      continue
    }
    numbers.push(match[1] ?? '')
  }

  for (let i = 0; i < numbers.length; i++) {
    const expected = String(i + 1).padStart(4, '0')
    if (numbers[i] !== expected) {
      findings.push({
        file: numberToFile(adrFiles).get(numbers[i] ?? '') ?? ADR_DIR,
        problem: `编号不连续：第 ${i + 1} 篇是 ${numbers[i]}，按排序应为 ${expected}（缺号或重号）`,
      })
      break
    }
  }

  const byNumber = numberToFile(adrFiles)

  for (const file of adrFiles) {
    const text = input.readText(file)
    const fileNumber = /(?:^|\/)(\d{4})-/.exec(file)?.[1] ?? ''

    // ② 标题编号
    const titleMatch = /^#[ \t]+ADR-(\d{4}):(.*)$/m.exec(text)
    const title = titleMatch ? (titleMatch[2] ?? '').trim() : ''
    if (!titleMatch || title === '') {
      findings.push({ file, problem: '首部标题不是 `# ADR-NNNN: <title>` 形态' })
    }
    else if (titleMatch[1] !== fileNumber) {
      findings.push({ file, problem: `标题编号 ADR-${titleMatch[1]} 与文件名 ${fileNumber} 不一致` })
    }

    // ③ 日期
    const date = dateOf(text)
    if (date === null)
      findings.push({ file, problem: '缺 `**Date:**` 行' })
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      findings.push({ file, problem: `\`**Date:**\` 不是 YYYY-MM-DD 形态（现值 ${date}）` })

    // ④ 状态
    const status = statusOf(text)
    if (status === null) {
      findings.push({ file, problem: '缺 `**Status:**` 行' })
    }
    else if (status.startsWith(SUPERSEDED_PREFIX)) {
      const target = status.slice(SUPERSEDED_PREFIX.length).trim()
      if (!/^\d{4}$/.test(target))
        findings.push({ file, problem: `\`Superseded by\` 的目标不是四位编号（现值 ${target}）` })
      else if (!byNumber.has(target))
        findings.push({ file, problem: `\`Superseded by ADR-${target}\` 指向的 ADR 不存在` })
    }
    else if (!(ADR_STATUSES as readonly string[]).includes(status)) {
      findings.push({
        file,
        problem: `\`**Status:**\` 取值不在枚举内（现值 ${status}；只允许 ${[...ADR_STATUSES, 'Superseded by ADR-NNNN'].join(' / ')}）`,
      })
    }

    // ⑤⑥ 小节
    const headings = headingsOf(text)
    const titles = headings.map(h => h.title)
    if (!titles.includes('Context'))
      findings.push({ file, problem: '缺 `## Context` 小节' })
    if (!titles.some(t => t === 'Decision' || t.startsWith('Decision ')))
      findings.push({ file, problem: '缺 `## Decision` 小节' })
    if (!titles.includes('Consequences'))
      findings.push({ file, problem: '缺 `## Consequences` 小节' })

    const altIndexes = headings
      .map((h, i) => (h.title === 'Alternatives considered' ? i : -1))
      .filter(i => i >= 0)
    if (altIndexes.length === 0) {
      findings.push({ file, problem: '缺 `## Alternatives considered` 小节' })
    }
    else if (altIndexes.length > 1) {
      findings.push({ file, problem: `\`## Alternatives considered\` 出现了 ${altIndexes.length} 次（只允许一个家）` })
    }
    else {
      const altIndex = altIndexes[0] ?? 0
      const firstDecision = headings.findIndex(h => h.title === 'Decision' || h.title.startsWith('Decision '))
      if (firstDecision >= 0 && altIndex < firstDecision)
        findings.push({ file, problem: '`## Alternatives considered` 排在第一个 `## Decision` 之前' })

      const start = headings[altIndex]?.offset ?? 0
      const end = headings[altIndex + 1]?.offset ?? text.length
      if (!/^\s*[-*][ \t]+\S/m.test(text.slice(start, end)))
        findings.push({ file, problem: '`## Alternatives considered` 里没有任何列表项（至少写一条）' })
    }
  }

  // ⑦ index.md 双向对齐
  const indexRows = indexRowsOf(input.indexText)

  if (indexRows.length === 0)
    findings.push({ file: `${ADR_DIR}/index.md`, problem: '`## ADR 列表` 里一行都没解析到（表格格式变了？）' })

  const listed = new Set(indexRows.map(r => r.number))
  for (const [number, file] of byNumber) {
    if (!listed.has(number))
      findings.push({ file: `${ADR_DIR}/index.md`, problem: `ADR ${number}（${path.posix.basename(file)}）没有登记进表格` })
  }

  for (const row of indexRows) {
    const file = byNumber.get(row.number)
    if (!file) {
      findings.push({ file: `${ADR_DIR}/index.md`, problem: `表格里的 ${row.number} 没有对应文件` })
      continue
    }
    if (!input.files.includes(`${ADR_DIR}/${row.target}`))
      findings.push({ file: `${ADR_DIR}/index.md`, problem: `第 ${row.number} 行链接到 ${row.target}，该文件不存在` })

    const status = statusOf(input.readText(file))
    if (status !== null && row.status !== status) {
      findings.push({
        file: `${ADR_DIR}/index.md`,
        problem: `第 ${row.number} 行的状态列是「${row.status}」，但文件里是「${status}」—— 两处必须逐字一致`,
      })
    }
  }

  return findings
}

export function adrFiles(): string[] {
  return lsFilesWithUntracked(`${ADR_DIR}/*.md`).sort()
}

export function main(): number {
  const files = adrFiles()
  const indexFile = `${ADR_DIR}/index.md`
  if (!files.includes(indexFile)) {
    console.error(`✖ 找不到 ${indexFile}`)
    return 2
  }

  const findings = collectFindings({
    files,
    indexText: fs.readFileSync(path.join(REPO_ROOT, indexFile), 'utf8'),
    readText: file => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'),
  })

  const count = files.filter(f => !NON_ADR_FILES.has(path.posix.basename(f))).length
  console.log(`ADR 形态校验：${count} 篇 ADR（状态枚举 ${ADR_STATUSES.join(' / ')} / Superseded by ADR-NNNN）`)

  if (findings.length === 0) {
    console.log('✅ 编号连续、状态在枚举内、四个必需小节齐备、index.md 双向对齐')
    return 0
  }

  const byFile = new Map<string, string[]>()
  for (const f of findings)
    byFile.set(f.file, [...(byFile.get(f.file) ?? []), f.problem])

  for (const [file, problems] of byFile) {
    console.error(`\n✖ ${file}`)
    for (const p of problems) console.error(`    ${p}`)
  }
  console.error(`\n共 ${findings.length} 处形态问题。形状约定见 apps/docs/src/zh-CN/content/adr/index.md。`)
  return 1
}

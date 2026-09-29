/**
 * 文档代码块形态校验：`apps/docs/src/` 里标注为 `ts` / `tsx` 的围栏块**必须能当 TypeScript 解析**。
 *
 * ## 为什么是「能解析」而不是「能编译」
 *
 * 这条门禁最初的设计是「fenced `ts` 块必须**编译**」。**实测后收窄成语法解析**，理由是量出来的：
 * 全仓 131 个 ts 块里，**零个**存在真正的 TypeScript 语法错误；解析失败的 9 个全部是另外两类
 * 问题 —— ① fence 标错了语言（`knip.md` 的 4 个块装的是**带注释的 JSON**）、② 有意的伪代码
 * （`{...}`、`Nullable<...>` 这类省略占位）。也就是说「必须编译」在这份语料上会 100% 误报，
 * 而**一个开始误报的门禁等于没有门禁**（本仓其它门禁的同一取舍见 `check-doc-refs.ts` 顶部）。
 *
 * 真要做类型检查，前提是绝大多数文档块得先写成完整模块（有 import、有上下文），那是**改文档**
 * 而不是加门禁 —— 不在本轮范围。所以这里只做**零误报**的那一半，把三类真问题抓死：
 *
 *   ① **`ts` 块里装 JSON**：拿 TypeScript 自己的 `parseJsonText`（就是解析 tsconfig 的那个 JSONC
 *      解析器）复验 —— 若 TS 解析失败但 JSONC 解析成功，判定为「标错语言」，并直接给出建议标签。
 *      这类块会让读者看到全错的语法高亮，`knip.md` 就有 4 个。
 *   ② **真的写坏了**：括号不闭合、片段截断、乱码、把两条语句粘成一行等。
 *   ③ **`json` 块里装的不是合法 JSON**（2026-09-29 加）：标了 `json` 就必须能 `JSON.parse` ——
 *      带注释、裸键、尾逗号的片段一律改标 `jsonc`。**`jsonc` 刻意不校验**，理由与两处实测
 *      数字见 `STRICT_JSON_LANGS` 的注释（那是一次文档改写，不是一条门禁）。
 *
 * ## 排除面（与 `check-doc-refs.ts` 严格同口径）
 *
 * `content/archive/` 与 `content/industry-research/` 是**冻结语料** —— 它们有意保留当时的样子，
 * 里面的伪代码（`Nullable<...>`）不该被今天的规矩判死。
 *
 * ## 有意的伪代码怎么标
 *
 * 块的第一行写成 `// @pseudo` 即豁免（见本文件 `PSEUDO_MARKER`）。要求写标记而不是放宽判据，
 * 是因为「哪些块是有意不合法」这件事只有作者知道；标记让它**显式**，而不是让门禁去猜。
 * 当前仓里 0 个块需要它 —— 原有 3 处伪代码要么改了语言标签、要么补成了合法写法。
 */

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { lsFilesWithUntracked } from '../lib/git.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** 冻结语料：有意保留当时样子的历史文档，不参与校验（与 check-doc-refs.ts 同一条口径） */
const FROZEN = /(?:^|\/)content\/(?:archive|industry-research)\//

/** 只扫文档站的源码树；仓库别处的 markdown（AGENTS.md / README / 包 README）暂不纳入 */
const DOCS_TREE = 'apps/docs/src/'

/** 会被当作 TypeScript 解析的围栏语言标注 */
const TS_LANGS = new Set(['ts', 'tsx', 'typescript'])

/**
 * 会被当作**严格 JSON** 校验的围栏语言标注。
 *
 * ⚠️ 刻意只收 `json`，**不收 `jsonc`** —— 这不是漏了，是量过之后的取舍（2026-09-29）：
 * 全仓 `json` / `jsonc` 块共 26 个，其中严格 `JSON.parse` 只有 3 个能过。`jsonc` 在本仓是
 * 「**带注释 / 裸键的 JSON5 片段**」这一桶（`apps/docs/AGENTS.md` 明确把 knip.md 那 4 个
 * 裸键块指到 `jsonc`），16 个里连 `ts.parseJsonText`（JSONC 解析器）都过不了 8 个。
 * 真按 JSONC 去校验 `jsonc`，等于要求一次**文档改写**（把那 8 个块改成合法 JSONC 或换标签），
 * 而不是加一条门禁 —— 与「宁可漏报，不可误报」的同一取舍。
 *
 * 于是这条门禁只做**定义上零误报**的那一半：既然标了 `json`，就必须真是合法 JSON。
 * 修法永远是「改标签成 `jsonc`」或「把内容补成合法 JSON」，没有第三种情况。
 */
const STRICT_JSON_LANGS = new Set(['json'])

/** 有意的伪代码：块的第一行写成这一行即豁免 */
export const PSEUDO_MARKER = '// @pseudo'

export interface DocBlock {
  /** 仓库相对路径 */
  file: string
  /** 块内第一行代码在文件里的行号（1-based），用于报错定位 */
  line: number
  /** 围栏上的语言标注 */
  lang: string
  /** 块内容（不含围栏行） */
  code: string
}

export interface DocTsFinding {
  file: string
  line: number
  kind: 'syntax' | 'json-in-ts' | 'json-syntax'
  message: string
}

/** 扫描面：文档站里的活文档（排除冻结语料） */
export function docFiles(): string[] {
  return lsFilesWithUntracked('*.md')
    .filter(f => f.startsWith(DOCS_TREE) && !FROZEN.test(f))
    .sort()
}

/**
 * 从 markdown 里抽出围栏代码块。**纯函数**（只吃文本），因此可以拿它直接写用例。
 *
 * 只认「整行是 ``` 或 ```lang」的围栏 —— 与 markdown-it 的行为一致（` ```ts{1,3} ` 这类带 meta 的
 * 写法本仓没用，真用了会走到「语言标注不认识 ⇒ 不检查」那一侧，宁可漏报）。
 */
export function fencedBlocks(file: string, markdown: string): DocBlock[] {
  const out: DocBlock[] = []
  const lines = markdown.split('\n')
  let open = false
  let lang = ''
  let body: string[] = []
  let start = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // 正则刻意写成 `^```(.*)$` + 事后 trim：`/^```[ \t]*([A-Z]*)[ \t]*$/` 里两个 `[ \t]*` 能互相
    // 吞空白，属于 regexp/no-super-linear-backtracking 要拦的形状。
    const fence = /^```(.*)$/.exec(line)
    if (!open && fence) {
      open = true
      // 语言标注就是围栏后的整段（trim + 小写）。` ```ts{1,3} ` 这类带 meta 的写法会得到
      // `ts{1,3}` —— 不在 TS_LANGS 里 ⇒ 不检查。宁可漏报，也不去猜 meta 的语法。
      lang = (fence[1] ?? '').trim().toLowerCase()
      body = []
      start = i + 2
      continue
    }
    if (open && line.trim() === '```') {
      open = false
      out.push({ file, line: start, lang, code: body.join('\n') })
      continue
    }
    if (open)
      body.push(line)
  }
  return out
}

/** 块的第一行是不是伪代码标记 */
function isPseudo(block: DocBlock): boolean {
  return (block.code.split('\n')[0] ?? '').trim() === PSEUDO_MARKER
}

/** 只留需要检查的 ts / tsx 块，并剔掉带伪代码标记的 */
export function tsBlocksOf(blocks: readonly DocBlock[]): DocBlock[] {
  return blocks.filter(b => TS_LANGS.has(b.lang) && !isPseudo(b))
}

/** 只留标成 `json` 的块（严格 JSON 校验面），并剔掉带伪代码标记的 */
export function jsonBlocksOf(blocks: readonly DocBlock[]): DocBlock[] {
  return blocks.filter(b => STRICT_JSON_LANGS.has(b.lang) && !isPseudo(b))
}

/**
 * 判定单个 `json` 块。**纯函数**（只吃块），用例直接喂它。
 *
 * 判据只有一条：标了 `json` 就必须能 `JSON.parse`。这里是**定义**而不是启发式 —— 所以零误报，
 * 不存在「这个块其实有意不合法」的灰区（真要有意，写 `@pseudo`，或者干脆改标 `jsonc`）。
 */
export function jsonFindingsOfBlock(block: DocBlock): DocTsFinding[] {
  try {
    JSON.parse(block.code)
    return []
  }
  catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    // Node 20+ 的 JSON.parse 报错里常带 `(line N column M)`；不带时（例如 `//` 注释那条）退回块首行。
    const at = /\(line (\d+) column \d+\)/.exec(raw)
    const line = at === null ? block.line : block.line + Number(at[1]) - 1
    return [{
      file: block.file,
      line,
      kind: 'json-syntax',
      message: `标成 \`json\` 的块不是合法 JSON —— JSON 不允许注释 / 裸键 / 尾逗号（${raw}）。`
        + '带注释或裸键的片段请把围栏改标 ```jsonc。',
    }]
  }
}

/**
 * 读 `parseDiagnostics`。
 *
 * ⚠️ 这个属性**运行时存在、但 TypeScript 的公开 `.d.ts` 里没有声明**（`createSourceFile` 与
 * `parseJsonText` 的返回值上都有；实测确认）。所以这里用一个窄的交叉类型把它读出来 ——
 * 而不是为了拿解析诊断去建一个完整的 Program（那要解析整个 tsconfig 与依赖图，代价高一个量级）。
 */
interface SourceFileWithParseDiagnostics {
  parseDiagnostics?: readonly ts.Diagnostic[]
}

function parseDiagnosticsOf(sf: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sf as ts.SourceFile & SourceFileWithParseDiagnostics).parseDiagnostics ?? []
}

/**
 * 这个块像不像「JSON 被标成了 ts」。
 *
 * 两层，因为本仓实测出现过两种形态：
 *   ① **JSON / JSONC** —— 直接用 TypeScript 自己的 `parseJsonText`（就是解析 tsconfig 的那个
 *      JSONC 解析器）复验，零诊断即判定。
 *   ② **JSON5 风格的片段** —— `knip.md` 里那 4 个块是 `"包名": { entry: [...] }`：**键带引号、
 *      子键裸写**。JSONC 解析器不认裸键（实测报 `'{' expected`），所以退一步看形状：
 *      首行是「带引号的键 + 冒号 + 对象/数组开头」。
 *      这条不会误伤 —— 顶层写 `"key": {...}` 在 TypeScript 里本来就不是合法语句，
 *      走到这里说明它已经解析失败了。
 */
function looksLikeJson(code: string): boolean {
  if (parseDiagnosticsOf(ts.parseJsonText('block.json', code)).length === 0)
    return true
  const firstLine = code.split('\n').find(l => l.trim() !== '') ?? ''
  return /^\s*"(?:[^"\\]|\\.)*"\s*:\s*[[{]/.test(firstLine)
}

/**
 * 判定单个块。**纯函数**（只吃块），用例直接喂它。
 *
 * 顺序很重要：先按 TS 解析，失败之后才去问「是不是其实装的 JSON」—— 反过来会把合法的 TS 块
 * （比如一句 `{ "a": 1 }` 之类的对象字面量）误判成 JSON。
 */
export function findingsOfBlock(block: DocBlock): DocTsFinding[] {
  const scriptKind = block.lang === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const name = block.lang === 'tsx' ? 'block.tsx' : 'block.ts'
  const sf = ts.createSourceFile(name, block.code, ts.ScriptTarget.Latest, false, scriptKind)
  const diags = parseDiagnosticsOf(sf)
  if (diags.length === 0)
    return []

  // ② 是不是「TS 解析不过、但内容其实是 JSON」⇒ 标错了语言
  if (looksLikeJson(block.code)) {
    return [{
      file: block.file,
      line: block.line,
      kind: 'json-in-ts',
      message: '这个块的内容是 JSON，却标成了 `ts` —— 语法高亮会全错。请把围栏改成 ```jsonc',
    }]
  }

  // ③ 真的写坏了：报第一条，并给出块内相对行号
  const first = diags[0]!
  const at = first.start === undefined
    ? block.line
    : block.line + sf.getLineAndCharacterOfPosition(first.start).line
  return [{
    file: block.file,
    line: at,
    kind: 'syntax',
    message: `TypeScript 解析失败：${ts.flattenDiagnosticMessageText(first.messageText, ' ')}`,
  }]
}

/** 收集全部 findings（纯逻辑：只依赖传入的文件清单与读取函数） */
export function collectFindings(
  files: readonly string[],
  readText: (file: string) => string,
): DocTsFinding[] {
  const out: DocTsFinding[] = []
  for (const file of files) {
    const blocks = fencedBlocks(file, readText(file))
    for (const block of tsBlocksOf(blocks))
      out.push(...findingsOfBlock(block))
    for (const block of jsonBlocksOf(blocks))
      out.push(...jsonFindingsOfBlock(block))
  }
  return out
}

export function main(): void {
  const files = docFiles()
  if (files.length === 0) {
    throw new PreconditionError('扫描面为空（0 篇文档）—— 拒绝把「扫不到东西」当绿灯')
  }

  const findings = collectFindings(files, f => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'))

  let tsCount = 0
  let jsonCount = 0
  for (const file of files) {
    const blocks = fencedBlocks(file, fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'))
    tsCount += tsBlocksOf(blocks).length
    jsonCount += jsonBlocksOf(blocks).length
  }

  out(`文档代码块校验：${files.length} 篇活文档里的 ${tsCount} 个 ts 块 + ${jsonCount} 个 json 块`)

  if (findings.length === 0) {
    line('ok', 'ts 块都能按 TypeScript 解析、json 块都是合法 JSON（没有截断/乱码/标错语言）')
    return
  }

  for (const f of findings)
    lineErr('violation', `${f.file}:${f.line}  [${f.kind}]\n    ${f.message}`)
  err(`\n共 ${findings.length} 处。有意的伪代码请在块的第一行写 \`${PSEUDO_MARKER}\`；`
    + '带注释或裸键的 JSON 片段请标 `jsonc`（`jsonc` 刻意不做严格校验，见本文件顶部）。')
  throw new ViolationError(`文档代码块有 ${findings.length} 处问题（明细见上）`)
}

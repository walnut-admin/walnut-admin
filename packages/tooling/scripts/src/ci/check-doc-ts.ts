/**
 * 文档代码块形态校验：`apps/docs/src/` 里标注为 `ts` / `tsx` 的围栏块**必须能当 TypeScript 解析**。
 *
 * ## 为什么是「能解析」而不是「能编译」
 *
 * 待办 F2 第③道原文写的是「fenced `ts` 块必须编译」。**实测后收窄成语法解析**，理由是量出来的：
 * 全仓 131 个 ts 块里，**零个**存在真正的 TypeScript 语法错误；解析失败的 9 个全部是另外两类
 * 问题 —— ① fence 标错了语言（`knip.md` 的 4 个块装的是**带注释的 JSON**）、② 有意的伪代码
 * （`{...}`、`Nullable<...>` 这类省略占位）。也就是说「必须编译」在这份语料上会 100% 误报，
 * 而**一个开始误报的门禁等于没有门禁**（本仓其它门禁的同一取舍见 `check-doc-refs.ts` 顶部）。
 *
 * 真要做类型检查，前提是绝大多数文档块得先写成完整模块（有 import、有上下文），那是**改文档**
 * 而不是加门禁 —— 不在本轮范围。所以这里只做**零误报**的那一半，把两类真问题抓死：
 *
 *   ① **`ts` 块里装 JSON**：拿 TypeScript 自己的 `parseJsonText`（就是解析 tsconfig 的那个 JSONC
 *      解析器）复验 —— 若 TS 解析失败但 JSONC 解析成功，判定为「标错语言」，并直接给出建议标签。
 *      这类块会让读者看到全错的语法高亮，`knip.md` 就有 4 个。
 *   ② **真的写坏了**：括号不闭合、片段截断、乱码、把两条语句粘成一行等。
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
import { lsFilesWithUntracked } from '../lib/git.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** 冻结语料：有意保留当时样子的历史文档，不参与校验（与 check-doc-refs.ts 同一条口径） */
const FROZEN = /(?:^|\/)content\/(?:archive|industry-research)\//

/** 只扫文档站的源码树；仓库别处的 markdown（AGENTS.md / README / 包 README）暂不纳入 */
const DOCS_TREE = 'apps/docs/src/'

/** 会被当作 TypeScript 解析的围栏语言标注 */
const TS_LANGS = new Set(['ts', 'tsx', 'typescript'])

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
  kind: 'syntax' | 'json-in-ts'
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

/** 只留需要检查的 ts / tsx 块，并剔掉带伪代码标记的 */
export function tsBlocksOf(blocks: readonly DocBlock[]): DocBlock[] {
  return blocks.filter((b) => {
    if (!TS_LANGS.has(b.lang))
      return false
    const first = (b.code.split('\n')[0] ?? '').trim()
    return first !== PSEUDO_MARKER
  })
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
    for (const block of tsBlocksOf(fencedBlocks(file, readText(file))))
      out.push(...findingsOfBlock(block))
  }
  return out
}

export function main(): number {
  const files = docFiles()
  if (files.length === 0) {
    console.error('✖ 扫描面为空（0 篇文档）—— 拒绝把「扫不到东西」当绿灯')
    return 2
  }

  const findings = collectFindings(files, f => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'))

  let blocks = 0
  for (const file of files)
    blocks += tsBlocksOf(fencedBlocks(file, fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'))).length

  console.log(`文档代码块校验：${files.length} 篇活文档里的 ${blocks} 个 ts 块`)

  if (findings.length === 0) {
    console.log('✅ 全部能按 TypeScript 解析（JSON 块没有标成 ts，也没有截断/乱码）')
    return 0
  }

  for (const f of findings)
    console.error(`\n✖ ${f.file}:${f.line}  [${f.kind}]\n    ${f.message}`)
  console.error(`\n共 ${findings.length} 处。有意的伪代码请在块的第一行写 \`${PSEUDO_MARKER}\`。`)
  return 1
}

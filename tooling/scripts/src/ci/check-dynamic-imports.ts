/**
 * `pnpm lint:dynamic-imports` —— `apps/**` 的**手写运行时代码**里不许出现「拼出来的」动态 import。
 *
 * ## 为什么需要它
 *
 * 2026-11 修掉了一个活了 4 个月的线上缺陷：`apps/admin/src/components/UI/Form/.../componentMap.ts`
 * 用四个工厂按「目录名 == 组件名」拼路径（`import(…${key}/index.ts)`）。三个组件被搬进
 * `@walnut/ui` 之后，路径仍指向 `apps/admin/src/components/UI/` —— 结果：
 *
 * - `tsc / vue-tsc` **看不见**：说明符不是字面量 ⇒ 拿不到可解析模块 ⇒ 不做存在性检查；
 * - `vite build` **绿**：`@rollup/plugin-dynamic-import-vars` 把它展开成一张 glob 表，
 *   表里没有的 key 到**运行期**才抛 `Unknown variable dynamic import`；
 * - 于是 `Base:Switch`（全仓 63 处使用）在页面上静默不渲染 —— 不报错、不占位。
 *
 * 这条门禁补的就是「没有人看得见」那一格：拼出来的说明符**静态扫描就能发现**，成本毫秒级。
 *
 * ## 判据（宁可漏报，不可误报）
 *
 * 只报两类「bundler 无法在构建期确定目标」的形态：
 *
 * 1. **模板字面量里带插值**：`import(`…${expr}…`)` —— 目标随运行值而变；
 * 2. **非字面量说明符**：`import(someVar)` —— 同上。
 *
 * **不报**的形态：
 *
 * - `import('…')` / `import("…")` —— 字符串字面量；
 * - 不含 ${ 的纯模板字面量（等价常量，Vite 视作静态说明符）；
 * - `import.meta.glob('…')` —— 不是 `import()` 形态；
 * - **注释**与**字符串正文**里的 `import()` —— 扫描前把注释抹成等长空白，并额外标记出
 *   「处在字符串/模板正文里的位置」；命中点落在正文里就跳过。
 *   （这一条是实测补的：`apps/server/eslint.config.ts` 的一句 ESLint message 里写了
 *   `import()`，第一版把它当成了违规。）
 *
 * ## 扫描面（为什么排掉这几类）
 *
 * | 排掉的 | 理由 |
 * |--------|------|
 * | `*.spec.ts` / `*.test.ts` | 测试**故意**按路径动态加载夹具（`await import(pathToFileURL(file).href)`），不是运行时代码 |
 * | 每个 app 的 `build/` 目录 | 构建期 Node 工具（如 iconify 图标集按名读取），在 Node 里跑、不进产物 |
 * | 源码树里的 `public/` 目录 | 原样搬运的第三方静态资产（minified vendor bundle），不改写 |
 *
 * 排掉之后 `ALLOWED` 保持**空表** —— 真正需要豁免时逐条写理由，别往路径前缀里塞。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { lsFilesWithUntracked } from '../lib/git.ts'
import { err, line, lineErr, out } from '../lib/log.ts'

/** 会写 `import()` 的源码后缀 */
const SCANNED_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue']

/** 扫描面：相对仓库根的前缀 */
const SCOPED_PREFIXES = ['apps/']

/** 扫描面的三类例外（理由见文件头表格） */
const EXCLUDED_PATH: readonly { pattern: RegExp, why: string }[] = [
  { pattern: /\.(?:spec|test)\.[cm]?[jt]sx?$/, why: '测试按路径动态加载夹具' },
  { pattern: /^apps\/[^/]+\/build\//, why: '构建期 Node 工具，不进产物' },
  { pattern: /\/public\//, why: '原样搬运的第三方静态资产' },
]

/** 豁免：仓库相对路径 → 理由（空表 = 更严） */
export const ALLOWED: Record<string, string> = {}

export type FindingKind = 'template' | 'non-literal'

export interface DynamicImportFinding {
  file: string
  /** 1 起算 */
  line: number
  kind: FindingKind
  /** 出事那行（截断到 140 字符），给人定位用 */
  snippet: string
}

interface Masked {
  /** 注释被抹成等长空白后的源码（字符串与模板原样保留） */
  text: string
  /** `true` = 该下标处在字符串 / 模板字面量的**正文**里（不含定界符本身） */
  inStringBody: boolean[]
}

/**
 * 一次遍历同时产出两样东西：抹掉注释的文本 + 「正文位置」掩码。
 *
 * 为什么要掩码：说明符本身就在引号/模板里，所以字符串**必须保留**（否则要查的东西被自己抹掉了）；
 * 但反过来，字符串正文里出现的 `import()`（例如一句 ESLint message）又不是代码 —— 靠掩码区分。
 *
 * 已知边界：模板字面量里的 ${ … }` 内部当正文处理（保守漏报，不会误报）。
 */
function maskSource(src: string): Masked {
  const chars = src.split('')
  const inStringBody = Array.from({ length: src.length }).fill(false) as boolean[]
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  let i = 0

  while (i < src.length) {
    const c = src[i]!
    const next = src[i + 1]

    if (state === 'code') {
      if (c === '/' && next === '/') {
        chars[i] = ' '
        chars[i + 1] = ' '
        state = 'line'
        i += 2
        continue
      }
      if (c === '/' && next === '*') {
        chars[i] = ' '
        chars[i + 1] = ' '
        state = 'block'
        i += 2
        continue
      }
      if (c === '\'') {
        state = 'single'
        i += 1
        continue
      }
      if (c === '"') {
        state = 'double'
        i += 1
        continue
      }
      if (c === '`') {
        state = 'template'
        i += 1
        continue
      }
      i += 1
      continue
    }

    if (state === 'line') {
      if (c === '\n') {
        state = 'code'
        i += 1
        continue
      }
      chars[i] = ' '
      i += 1
      continue
    }

    if (state === 'block') {
      if (c === '*' && next === '/') {
        chars[i] = ' '
        chars[i + 1] = ' '
        state = 'code'
        i += 2
        continue
      }
      if (c !== '\n')
        chars[i] = ' '
      i += 1
      continue
    }

    // 字符串 / 模板内部
    if (c === '\\') {
      i += 2
      continue
    }
    if ((state === 'single' && c === '\'') || (state === 'double' && c === '"') || (state === 'template' && c === '`')) {
      state = 'code'
      i += 1
      continue
    }
    inStringBody[i] = true
    i += 1
  }

  return { text: chars.join(''), inStringBody }
}

/** 抹注释（等长空白、保留行号），字符串与模板原样 —— 供门禁与用例共用 */
export function stripComments(src: string): string {
  return maskSource(src).text
}

/** 从模板字面量起始反引号之后，找到配对的收尾反引号下标（不处理嵌套，够用） */
export function templateEnd(src: string, openIndex: number): number {
  for (let i = openIndex + 1; i < src.length; i++) {
    if (src[i] === '\\') {
      i += 1
      continue
    }
    if (src[i] === '`')
      return i
  }
  return src.length
}

/** 扫一段源码文本（纯函数，供门禁与用例共用） */
export function scanSource(file: string, text: string): DynamicImportFinding[] {
  const { text: masked, inStringBody } = maskSource(text)
  const findings: DynamicImportFinding[] = []
  const re = /\bimport\s*\(/g

  // 用 for(;;) + 显式 break 而不是 while((m = re.exec(...)) !== null)：
  // 循环体里有多个 continue，靠尾部推进会让 continue 跳过推进 ⇒ 死循环；
  // 而带赋值的 while 条件又会被 no-cond-assign 拦。
  for (;;) {
    const match = re.exec(masked)
    if (match === null)
      break

    // 命中点本身在字符串正文里 ⇒ 那是数据，不是代码
    if (inStringBody[match.index])
      continue

    // `obj.import(x)` 是**属性访问**，不是动态 import（`import` 前面隔着空白是一个 `.`）
    let prev = match.index - 1
    while (prev >= 0 && /\s/.test(masked[prev]!))
      prev -= 1
    if (prev >= 0 && masked[prev] === '.')
      continue

    let cursor = match.index + match[0].length
    while (cursor < masked.length && /\s/.test(masked[cursor]!))
      cursor += 1
    const head = masked[cursor]

    if (head === '\'' || head === '"')
      continue

    if (head === '`') {
      const body = masked.slice(cursor + 1, templateEnd(masked, cursor))
      if (!body.includes('${'))
        continue
      findings.push(findingAt(file, masked, match.index, 'template'))
      continue
    }

    findings.push(findingAt(file, masked, match.index, 'non-literal'))
  }

  return findings
}

function findingAt(file: string, masked: string, index: number, kind: FindingKind): DynamicImportFinding {
  const before = masked.slice(0, index)
  const line = before.split('\n').length
  const lineStart = before.lastIndexOf('\n') + 1
  const lineEnd = masked.indexOf('\n', index)
  const snippet = masked.slice(lineStart, lineEnd === -1 ? masked.length : lineEnd).trim().slice(0, 140)
  return { file, line, kind, snippet }
}

/** 扫描面：被 git 跟踪、落盘存在、且不在三类例外里的 `apps/**` 源码 */
export function listScannedFiles(repoRoot: string): string[] {
  // 用 `lsFilesWithUntracked` 而不是裸 `git ls-files`：后者只读**索引** ⇒ 新建但还没 `git add`
  // 的源文件不参与扫描，于是"写完先本地跑一遍"得到的是假绿，`git add` 之后同一份代码才变红。
  // `--exclude-standard` 仍然生效（dist / node_modules 不会被卷进来），与 `check-doc-refs` 同一口径。
  return lsFilesWithUntracked('*')
    .filter(f => SCOPED_PREFIXES.some(p => f.startsWith(p)))
    .filter(f => SCANNED_EXT.some(ext => f.endsWith(ext)))
    .filter(f => !EXCLUDED_PATH.some(e => e.pattern.test(f)))
    .filter(f => existsSync(join(repoRoot, f)))
    .sort()
}

export function collectFindings(repoRoot: string, files: string[] = listScannedFiles(repoRoot)): DynamicImportFinding[] {
  const findings: DynamicImportFinding[] = []
  for (const file of files) {
    if (file in ALLOWED)
      continue
    findings.push(...scanSource(file, readFileSync(join(repoRoot, file), 'utf8')))
  }
  return findings
}

export function main(): void {
  const repoRoot = process.cwd()
  const files = listScannedFiles(repoRoot)
  if (files.length === 0)
    throw new PreconditionError('扫描面为空（apps/ 下 0 个源码文件）—— 拒绝把「扫不到东西」当绿灯')

  out(`动态 import 检查：${files.length} 个 apps/ 下的手写运行时代码；豁免 ${Object.keys(ALLOWED).length} 条`)

  const findings = collectFindings(repoRoot, files)
  if (findings.length === 0) {
    line('ok', '没有拼出来的动态 import（说明符都是字面量或纯模板字面量）')
    return
  }

  for (const f of findings.slice(0, 40)) {
    const label = f.kind === 'template' ? '模板插值' : '非字面量'
    lineErr('violation', `${f.file}:${f.line}  [${label}]  ${f.snippet}`)
  }
  if (findings.length > 40)
    err(`… 另有 ${findings.length - 40} 处`)

  err('')
  err('为什么禁：拼出来的模块说明符在 tsc 与 vite build 里都不报错，只在运行期抛 Unknown variable dynamic import。')
  err('修法：改成字面量说明符（import(\'@/components/UI/Switch\')），或用一个显式注册表把路径写死；')
  err('     确实无法静态化（构建期工具 / 测试夹具 / 第三方资产）时，先看文件头的扫描面表格，再考虑 ALLOWED。')
  throw new ViolationError(`有 ${findings.length} 处拼出来的动态 import（明细见上）`)
}

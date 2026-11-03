import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { PreconditionError, ViolationError } from '../lib/errors.ts'
/**
 * 包 `exports` 的形态体检（对比页 C2 的 `exports-shape`）。
 *
 * ## 它防的是哪一种失败
 *
 * 本仓的共享包**不经过构建**就被消费（`exports` 指 `./src/**`，见 ADR 0013），所以 `exports` 写错
 * 一个字符的后果**不是报错，是解析到别的东西或者解析不到** —— 而症状往往出现在很远的地方
 * （某个下游包的 `types:check` 报一个看不懂的错，或者运行时才发现拿到的是 CJS 产物）。
 * 这一面此前**零判据**：15 个包的 `exports` 全靠人工对齐。
 *
 * ## 四条不变量（每条都在真仓上量过，当前全绿）
 *
 * | # | 判据 | 不守会怎样 |
 * |---|---|---|
 * | 1 | `exports-target-exists`：**字面量**目标必须真实存在 | 写错路径 = 静默解析失败 |
 * | 2 | `exports-glob-matches`：**通配**目标至少要命中一个文件（`*` 跨 `/`，与 Node 一致） | `./src/*.ts` 写成 `./sr/*.ts` 一样是解析失败，而 `existsSync` 看不出来 |
 * | 3 | `types-condition-order`：条件对象里 `types` 必须排在 `import` / `require` / `default` 之前 | 顺序反了 ⇒ 解析器先命中 JS，**类型静默丢失**（TS 官方明确要求 `types` 在前） |
 * | 4 | `root-conditions-match-top-level`：`exports["."]` 与顶层 `main` / `types` 不许互相矛盾 | 两种解析器看到**不同入口** —— 上一轮实测过：后端其实是靠 node10 的 `main` / `types` 顶层字段解析 contract 的，不是靠 `exports` 条件 |
 *
 * ## 关键取舍（都来自实测，别改回去）
 *
 * - **产物（gitignore 的路径）不查存在性**：`./dist/*.cjs` 这类目标只有构建后才在。
 *   若按"文件在不在盘上"判，这条门禁会**本机绿、干净检出（CI）红** ——
 *   2026-09-23 在 `check-doc-refs` 上刚踩过同一个坑（`env-local/`）。判据只能是
 *   「**仓库里该有的文件在不在**」，产物不属于仓库。
 * - **`types` 只跟 `import` / `require` / `default` 比先后，不要求排第一**：本仓的
 *   `source` 条件写在 `types` 前面（那是给"源码直消费"用的自定义条件），要求 `types` 置顶
 *   会当场误报 5 个包 —— 而真正会吃掉类型的只有后三个解析条件。
 * - **通配目标只要求"至少命中一个"**，不要求逐个展开核对（`./*` 本来就该覆盖未来新增的文件）。
 * - **通配的 `*` 语义单独实现（`exportsPatternMatches`），不复用 `globMatchesSomething`**：
 *   后者是「文件 glob」语义（`*` = 单段 `[^/]*`，对 turbo 的 inputs/outputs 是对的），
 *   而 Node 的 exports **子路径模式**里 `*` 可以跨 `/`。共用一套语义的后果是**假红**：
 *   `@walnut/client` 的 `./*` → `./src/*.ts` 要解析 `client/browser/cookie`，删掉
 *   `src/` 根下的那几个文件后门禁会在「解析完全正常」的情况下报 `exports-glob-matches`
 *   （2026-11 · 批次 4 实测过一次，当时是删桶后 `src/index.ts` 没了、靠 `queue.ts`/`regex.ts`
 *   留在根下才碰巧变绿）。
 *
 * ## 不做什么
 *
 * 不审计 `files` / `publishConfig` / 版本号（那是发版的事），也不判断"这个包该不该有 `exports`"
 * （工具链包有没有 `exports` 是本仓有意的差异，不是漂移）。
 */
import { ignoredPaths } from '../lib/git.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'
import { workspacePackages } from '../lib/workspace.ts'
import { globMatchesSomething } from './check-turbo-cache.ts'

export interface Finding {
  rule: string
  /** 包名（比目录好认） */
  package: string
  detail: string
}

/** 会「吃掉类型」的解析条件：`types` 必须排在它们之前 */
const JS_CONDITIONS = ['import', 'require', 'default'] as const

interface ExportTarget {
  /** `${subpath}` 或 `${subpath}.${condition}`，报错时用 */
  label: string
  /** 包内相对路径（`./src/index.ts`） */
  target: string
}

/**
 * 把一个包的 `exports` 摊平成「一串目标路径」。
 *
 * `label` 要能一眼定位，所以顶层键（子路径）与更深的键（条件）**分两种写法**：
 * `exports["./base"]` 与 `exports["."].require`。第一版把两者混在一条字符串里，
 * 报出来是 `exports[""../broken]` 这种读不懂的东西（实测）。
 */
export function flattenExportTargets(pkgName: string, exportsField: unknown): ExportTarget[] {
  const out: ExportTarget[] = []
  const walk = (value: unknown, subpath: string | null, condition: string): void => {
    if (typeof value === 'string') {
      out.push({ label: `${pkgName} exports[${JSON.stringify(subpath)}]${condition === '' ? '' : `.${condition}`}`, target: value })
      return
    }
    if (value === null || typeof value !== 'object')
      return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (subpath === null)
        walk(child, key, '') // 顶层键 = 子路径
      else
        walk(child, subpath, condition === '' ? key : `${condition}.${key}`) // 再往下 = 条件
    }
  }
  walk(exportsField, null, '')
  return out
}

/**
 * exports **子路径模式**（含 `*` 的目标）是否至少命中一个真实文件 —— 与 Node 同语义：
 * 模式里的 `*` **可以跨 `/`**（Node 把目标里的 `*` 换成子路径匹配到的那一段，那一段
 * 本身允许含斜杠：`@walnut/client/browser/cookie` 就是 `./*` → `./src/*.ts`）。
 *
 * 实现：把第一个 `*` 之前、最后一个 `/` 之前的**静态前缀**当根，递归列出该根下的全部文件，
 * 用「其余部分转成的正则」逐个试。`*` → `.*`（含 `/`），其余字符按字面量转义。
 * 只要求「命中 ≥1 个**文件**」（目录不算命中：exports 目标是文件）。
 */
export function exportsPatternMatches(pattern: string, cwd = REPO_ROOT): boolean {
  const star = pattern.indexOf('*')
  if (star < 0)
    return globMatchesSomething(pattern, cwd)

  const slash = pattern.lastIndexOf('/', star)
  const base = slash < 0 ? '.' : pattern.slice(0, slash)
  const rest = slash < 0 ? pattern : pattern.slice(slash + 1)
  const abs = path.join(cwd, base)
  if (!existsSync(abs))
    return false

  const re = new RegExp(`^${rest.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)

  let entries
  try {
    entries = readdirSync(abs, { recursive: true, withFileTypes: true })
  }
  catch {
    return false
  }
  for (const entry of entries) {
    if (!entry.isFile())
      continue
    // Dirent.parentPath 是本轮 readdir 的父目录（Node 20.12+；Node >= 24 是本仓下限）
    const relative = path.relative(abs, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
    if (re.test(relative))
      return true
  }
  return false
}

/** 条件对象的键顺序：`types` 是否排在会吃掉它的那几个之前 */
export function typesComesFirst(keys: string[]): boolean {
  const typesAt = keys.indexOf('types')
  if (typesAt === -1)
    return true
  const firstJs = keys.findIndex(k => (JS_CONDITIONS as readonly string[]).includes(k))
  return firstJs === -1 || typesAt < firstJs
}

/** 收集所有发现（纯函数便于单测；`ignore` 注入被 gitignore 的路径集合） */
export function collectFindings(
  packages = workspacePackages(),
  ignore: (paths: Iterable<string>) => Set<string> = ignoredPaths,
  cwd = REPO_ROOT,
): Finding[] {
  const findings: Finding[] = []

  // 先把所有「要问 git」的路径攒起来，一次问完（逐条 spawn 是 15 秒级的代价，实测）
  const candidates = new Set<string>()
  for (const { dir, manifest } of packages) {
    if (manifest.exports === undefined)
      continue
    for (const { target } of flattenExportTargets(manifest.name ?? dir, manifest.exports)) {
      if (!target.startsWith('./'))
        continue
      candidates.add(`${dir}/${target.slice(2)}`)
    }
  }
  const ignored = ignore(candidates)
  const isArtifact = (repoRelative: string): boolean => {
    // 目标本身或其所在目录被忽略 ⇒ 产物，不查存在性
    const noSlash = repoRelative.replace(/\/$/, '')
    return ignored.has(noSlash) || ignored.has(noSlash.replace(/\/[^/]+$/, ''))
  }

  for (const { dir, manifest } of packages) {
    const name = manifest.name ?? dir
    const exportsField = manifest.exports
    if (exportsField === undefined)
      continue

    if (typeof exportsField !== 'object' || exportsField === null) {
      findings.push({ rule: 'exports-target-exists', package: name, detail: '`exports` 必须是对象（字符串形式没法表达子路径）' })
      continue
    }

    for (const { label, target } of flattenExportTargets(name, exportsField)) {
      if (!target.startsWith('./')) {
        findings.push({ rule: 'exports-target-exists', package: name, detail: `${label} → \`${target}\` 不是相对路径（本仓所有 exports 目标都以 ./ 开头）` })
        continue
      }
      const repoRelative = `${dir}/${target.slice(2)}`
      if (isArtifact(repoRelative))
        continue // 产物：构建后才在，不查存在性（见文件头）
      if (target.includes('*')) {
        // exports 的子路径模式与「文件 glob」不是一套语义：这里的 `*` 跨 `/`（见 exportsPatternMatches）
        if (!exportsPatternMatches(repoRelative, cwd))
          findings.push({ rule: 'exports-glob-matches', package: name, detail: `${label} → \`${target}\` 一个文件都没命中（通配写错了？）` })
      }
      else if (!globMatchesSomething(repoRelative, cwd)) {
        findings.push({ rule: 'exports-target-exists', package: name, detail: `${label} → \`${target}\` 不存在` })
      }
    }

    // 条件顺序（只看 `exports["."]` 这一层：子路径通常与它同形，全查会刷屏；但 "." 缺了就不查）
    const root = (exportsField as Record<string, unknown>)['.']
    if (root !== undefined && typeof root === 'object' && root !== null && !Array.isArray(root)) {
      const keys = Object.keys(root as Record<string, unknown>)
      if (!typesComesFirst(keys)) {
        findings.push({
          rule: 'types-condition-order',
          package: name,
          detail: `exports["."] 的条件顺序是 [${keys.join(', ')}] —— \`types\` 必须排在 ${JS_CONDITIONS.join(' / ')} 之前，否则解析器先命中 JS、类型静默丢失`,
        })
      }
      // 与顶层 main / types 的一致性（两种解析器看到的入口必须相同）
      const map = root as Record<string, string>
      const topMain = manifest.main
      const topRequire = map.require ?? map.default
      if (topMain !== undefined && topRequire !== undefined && topMain !== topRequire) {
        findings.push({
          rule: 'root-conditions-match-top-level',
          package: name,
          detail: `顶层 main 是 \`${topMain}\`，而 exports["."].require/default 是 \`${topRequire}\` —— 老解析器（node10）与新解析器会看到**不同入口**`,
        })
      }
      const topTypes = manifest.types ?? manifest.typings
      if (topTypes !== undefined && map.types !== undefined && topTypes !== map.types) {
        findings.push({
          rule: 'root-conditions-match-top-level',
          package: name,
          detail: `顶层 types 是 \`${topTypes}\`，而 exports["."].types 是 \`${map.types}\` —— 类型入口两边不一致`,
        })
      }
    }
  }

  return findings
}

export function main(): void {
  let findings: Finding[]
  try {
    findings = collectFindings()
  }
  catch (e) {
    throw new PreconditionError(`拿不到包清单或 gitignore 信息：${(e as Error).message}`)
  }

  const packages = workspacePackages()
  const withExports = packages.filter(p => p.manifest.exports !== undefined).length
  out(`包 exports 形态体检：${packages.length} 个 workspace 包，其中 ${withExports} 个声明了 \`exports\``)

  if (findings.length === 0) {
    line('ok', '目标都存在 / 通配都有命中 / `types` 条件在前 / 与顶层 main·types 不矛盾。')
    out('   提示：**产物（gitignore 的路径，如 ./dist/*.cjs）不查存在性** —— 判据是"仓库里该有的文件在不在"。')
    return
  }

  lineErr('violation', `有 ${findings.length} 处 exports 形态问题：\n`)
  for (const f of findings)
    err(`  [${f.rule}] ${f.detail}`)
  err('\n改完请跑 `pnpm lint:exports` 复验；这类错的症状通常出现在很远的下游（解析到别的入口 / 类型丢失）。')
  throw new ViolationError(`包 exports 有 ${findings.length} 处形态问题（明细见上）`)
}

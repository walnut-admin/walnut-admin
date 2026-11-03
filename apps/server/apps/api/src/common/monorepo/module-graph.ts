import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

/**
 * 组合根静态图工具（**只给 drift spec 用**，不参与运行期装配）。
 *
 * 为什么是「静态解析」而不是 import 一侧的 AppModule：跑本套 spec 的位置就是**求值期**，
 * import '@/app/app.module' 会把整张 api 图拉起来 —— @walnut-server/security/cap/cap.service
 * 的 new Cap() 会在 .data/ 建文件并抢注册 SIGTERM（R1 §2.4 实测），
 * 而本批 spec 的**断言对象**恰恰是「这些副作用不该发生」。用一个会触发副作用的动作去
 * 断言副作用不存在，是自欺。所以这里只做「读源码 + 解析 import 图」，零装载、零副作用
 * （与 lib-registration.drift.spec.ts / repo-global.drift.spec.ts 同款形态）。
 *
 * cwd 口径：vitest 的 test.root 是 './'（apps/api/vitest.config.ts:17），
 * 从 apps/server/ 起，与既有 drift spec 一致。
 */

export const SERVER_ROOT = process.cwd()

/** tsconfig compilerOptions.paths 的一条（已剥掉前导 './'） */
interface IPathMapping {
  pattern: string
  target: string
}

function readTsconfigPaths(): IPathMapping[] {
  const tsconfig = JSON.parse(
    readFileSync(resolve(SERVER_ROOT, 'tsconfig.json'), 'utf8'),
  ) as { compilerOptions: { paths: Record<string, string[]> } }

  return Object.entries(tsconfig.compilerOptions.paths).map(([pattern, targets]) => ({
    pattern,
    target: targets[0].replace(/^\.\//, ''),
  }))
}

const PATH_MAPPINGS = readTsconfigPaths()

/** '@/*' -> 'apps/api/src/*'、'@walnut-server/guards/*' -> 'libs/guards/src/*' … */
function mapAlias(specifier: string): string | null {
  // 先吃「无通配」的精确别名，避免被带 * 的条目误匹配
  for (const m of PATH_MAPPINGS) {
    if (!m.pattern.includes('*') && m.pattern === specifier) {
      return m.target
    }
  }
  for (const m of PATH_MAPPINGS) {
    if (!m.pattern.includes('*')) {
      continue
    }
    const star = m.pattern.indexOf('*')
    const prefix = m.pattern.slice(0, star)
    const suffix = m.pattern.slice(star + 1)
    if (
      specifier.startsWith(prefix)
      && specifier.endsWith(suffix)
      && specifier.length >= prefix.length + suffix.length
    ) {
      const captured = specifier.slice(prefix.length, specifier.length - suffix.length)
      return m.target.replace('*', captured)
    }
  }
  return null
}

function existingTsFile(candidate: string): string | null {
  // .d.ts 是纯类型声明，运行期不会被 require —— 收进闭包只会制造噪声
  for (const probe of [`${candidate}.ts`, `${candidate}/index.ts`, candidate]) {
    if (probe.endsWith('.d.ts')) {
      continue
    }
    if (existsSync(probe) && statSync(probe).isFile()) {
      return resolve(probe)
    }
  }
  return null
}

/**
 * 把一个 import specifier 解析成仓库内的 .ts 绝对路径；仓库外（node_modules / 内置模块）返回 null。
 * fromAbs 必须是**绝对路径**，相对 specifier 以它的目录为基准。
 */
export function resolveSpecifier(fromAbs: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    return existingTsFile(resolve(dirname(fromAbs), specifier))
  }
  if (specifier.startsWith('/')) {
    return null
  }
  const mapped = mapAlias(specifier)
  return mapped === null ? null : existingTsFile(resolve(SERVER_ROOT, mapped))
}

/** 相对 'apps/server/' 的 posix 路径（断言的唯一口径，跨平台稳定） */
export function toRepoPath(abs: string): string {
  return relative(SERVER_ROOT, abs).split(sep).join('/')
}

// ─── 源码扫描小工具（括号 / 字符串感知，避免把注释里的括号当结构）───────────────

/** 从 open 指向的 ( [ { 出发，返回配对的闭括号下标（跳过字符串与注释） */
function matchBracket(source: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const expected: string[] = [pairs[source[open]]]
  let i = open + 1
  while (i < source.length && expected.length > 0) {
    const ch = source[i]
    if (ch === '\'' || ch === '"' || ch === '\u0060') {
      i++
      while (i < source.length && source[i] !== ch) {
        i += source[i] === '\\' ? 2 : 1
      }
      i++
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i)
      i = nl === -1 ? source.length : nl + 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (pairs[ch] !== undefined) {
      expected.push(pairs[ch])
    }
    else if (ch === expected[expected.length - 1]) {
      expected.pop()
    }
    i++
  }
  return expected.length === 0 ? i - 1 : -1
}

/** 取 key: [ ... ] / key: { ... } 里那个容器**内部**的源文本；没有该键返回 null */
function valueOfKey(objectSource: string, key: string): string | null {
  const re = new RegExp(`\\b${key}\\s*:\\s*([\\[{])`)
  const hit = re.exec(objectSource)
  if (!hit) {
    return null
  }
  const open = hit.index + hit[0].length - 1
  const close = matchBracket(objectSource, open)
  return close === -1 ? null : objectSource.slice(open + 1, close)
}

/** 一个文件里的 import 面：本地名 -> specifier */
function importBindings(source: string): Map<string, string> {
  const bindings = new Map<string, string>()

  const named = /\bimport\s+(?:type\s+)?(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+))\s*from\s*['"]([^'"]+)['"]/g
  for (const m of source.matchAll(named)) {
    const defaultName = m[1]
    const namedPart = m[2]
    const starName = m[3]
    const specifier = m[4]
    if (defaultName) {
      bindings.set(defaultName, specifier)
    }
    if (starName) {
      bindings.set(starName, specifier)
    }
    if (namedPart) {
      for (const piece of namedPart.split(',')) {
        const local = piece.trim().split(/\s+as\s+/).pop()
        if (local !== undefined && local !== '') {
          bindings.set(local.trim(), specifier)
        }
      }
    }
  }

  const sideEffect = /\bimport\s+['"]([^'"]+)['"]/g
  for (const m of source.matchAll(sideEffect)) {
    bindings.set(m[1], m[1])
  }

  return bindings
}

/** 一个 @Module() 类在源码里的静态面 */
export interface IModuleDeclaration {
  className: string
  imports: string[]
  /** APP_GUARD 的 useClass 标识符，按 providers 声明顺序 */
  guardClasses: string[]
  /** 全部 providers 的 useClass / 裸类名，按声明顺序（含 guard） */
  providerNames: string[]
}

/** 解析一个 .ts 文件里的全部 @Module() 类（绝大多数文件只有一个） */
export function readModuleDeclarations(abs: string): IModuleDeclaration[] {
  const source = readFileSync(abs, 'utf8')
  const declarations: IModuleDeclaration[] = []
  const decorator = /@Module\s*\(/g

  for (const hit of source.matchAll(decorator)) {
    const open = hit.index + hit[0].length - 1
    const close = matchBracket(source, open)
    if (close === -1) {
      continue
    }
    // @Module({...}) 的实参：通常是对象字面量
    const argStart = source.indexOf('{', open)
    const argClose = argStart === -1 ? -1 : matchBracket(source, argStart)
    const objectSource = argStart === -1 || argStart > close || argClose === -1
      ? ''
      : source.slice(argStart, argClose + 1)

    const classHit = /export\s+class\s+([\w$]+)/.exec(source.slice(close))
    if (!classHit) {
      continue
    }

    const importsBlock = valueOfKey(objectSource, 'imports')
    const providersBlock = valueOfKey(objectSource, 'providers')

    const imports = importsBlock === null
      ? []
      : (importsBlock.match(/\b[A-Z][\w$]*\b/g) ?? [])

    const guardClasses: string[] = []
    const providerNames: string[] = []
    if (providersBlock !== null) {
      for (const guardObject of providersBlock.match(/\{[^{}]*\bAPP_GUARD\b[^{}]*\}/g) ?? []) {
        const useClass = /useClass\s*:\s*([\w$]+)/.exec(guardObject)
        if (useClass) {
          guardClasses.push(useClass[1])
        }
      }
      for (const useClass of providersBlock.matchAll(/useClass\s*:\s*([\w$]+)/g)) {
        providerNames.push(useClass[1])
      }
      for (const bare of providersBlock.matchAll(/(?:^|[{,\s])([A-Z][\w$]*)\s*(?:,|\})/g)) {
        providerNames.push(bare[1])
      }
    }

    declarations.push({
      className: classHit[1],
      imports,
      guardClasses,
      providerNames,
    })
  }

  return declarations
}

/** 走查结果的一站 */
export interface IModuleNode extends IModuleDeclaration {
  /** 相对 'apps/server/' 的 posix 路径 */
  file: string
}

/**
 * 从入口文件做**前序 DFS**，返回模块被扫描的顺序（= container.getModules() 的插入序，
 * 也就是 enhancer 的装配序；见 R1 §4.1 C1 引的 scanner.js:262-291 / :44-95）。
 *
 * 语义对齐 Nest：同一模块（同一个 export class）只会被扫一次 —— import 两次不会双装配，
 * 所以这里按 file#className 去重。
 */
export function walkModuleGraph(entryFile: string): IModuleNode[] {
  const nodes: IModuleNode[] = []
  const seen = new Set<string>()

  const visit = (absFile: string): void => {
    if (!existsSync(absFile)) {
      return
    }
    const source = readFileSync(absFile, 'utf8')
    const bindings = importBindings(source)
    for (const declaration of readModuleDeclarations(absFile)) {
      const key = `${toRepoPath(absFile)}#${declaration.className}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      nodes.push({ ...declaration, file: toRepoPath(absFile) })

      for (const identifier of declaration.imports) {
        const specifier = bindings.get(identifier)
        if (specifier === undefined) {
          continue
        }
        const target = resolveSpecifier(absFile, specifier)
        if (target !== null) {
          visit(target)
        }
      }
    }
  }

  visit(resolve(SERVER_ROOT, entryFile))
  return nodes
}

// ─── 文件级 import 闭包（G1 / G3 共用）─────────────────────────────────────────
//
// 为什么还必须有这一层：上面 walkModuleGraph 只在「imports 里的标识符能解析到同文件里的
// @Module 类」时才往下走，遇到指向 barrel（index.ts、没有 @Module 声明）的别名边就**断**了。
// 做「模块扫描序」够用（enhancer 只注册在两个文件里），做「深度隔离」不够 ——
// 文件级闭包没有这个问题：它只关心谁 require 谁，与导出名无关。

/** 一条 import 面（含 export-from 与 require）—— 收全比收漏安全：过度收只会**放大**闭包 */
const CLOSURE_SPECIFIER_PATTERNS = [
  /from\s*['"]([^'"]+)['"]/g,
  /import\s+['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

/** 一个文件直接 import 到的 specifier（去重） */
export function specifiersOf(absFile: string): string[] {
  const source = readFileSync(absFile, 'utf8')
  const found = new Set<string>()
  for (const pattern of CLOSURE_SPECIFIER_PATTERNS) {
    // matchAll 自带「克隆正则 + 从 0 扫」，不依赖 lastIndex，也就不会跨调用串味
    for (const hit of source.matchAll(pattern)) {
      found.add(hit[1])
    }
  }
  return [...found]
}

export interface IImportClosure {
  /** 闭包内全部文件的 repo 相对路径 */
  files: Set<string>
  /** repo 相对路径 -> 它直接 import 到的 repo 相对路径（用于打印最短链） */
  edges: Map<string, string[]>
}

/**
 * 从入口文件做 BFS，得到「运行期会被 require 到的 .ts 集合」。
 *
 * 这就是「模块求值级」的判据：文件在集合里 = 它的顶层代码会被执行 ——
 * 对 cap.service.ts 而言，那就是 new Cap()（建 .data + 抢注册 SIGTERM）。
 */
export function importClosure(entryFile: string): IImportClosure {
  const entryAbs = resolve(SERVER_ROOT, entryFile)
  const seen = new Set<string>([entryAbs])
  const edges = new Map<string, string[]>()
  const queue: string[] = [entryAbs]

  while (queue.length > 0) {
    const current = queue.shift() as string
    const currentRepo = toRepoPath(current)
    const resolved: string[] = []

    for (const specifier of specifiersOf(current)) {
      const target = resolveSpecifier(current, specifier)
      if (target === null) {
        continue
      }
      resolved.push(toRepoPath(target))
      if (!seen.has(target)) {
        seen.add(target)
        queue.push(target)
      }
    }

    edges.set(currentRepo, resolved)
  }

  const files = new Set<string>()
  for (const abs of seen) {
    files.add(toRepoPath(abs))
  }
  return { files, edges }
}

/** 最短 import 链（失败信息里给「为什么它在」—— 比一句 not.toContain 有用得多） */
export function shortestChain(
  closure: IImportClosure,
  entryFile: string,
  target: string,
): string[] | null {
  const parent = new Map<string, string>()
  const visited = new Set<string>([entryFile])
  const queue: string[] = [entryFile]

  while (queue.length > 0) {
    const current = queue.shift() as string
    if (current === target) {
      const chain = [current]
      let cursor = current
      while (parent.has(cursor)) {
        cursor = parent.get(cursor) as string
        chain.unshift(cursor)
      }
      return chain
    }
    for (const next of closure.edges.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next)
        parent.set(next, current)
        queue.push(next)
      }
    }
  }
  return null
}

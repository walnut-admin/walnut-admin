import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 路由目录 drift 守卫（U2a）—— 防「controller 路由 ↔ `@walnut/contract` 路由常量」漂移。
 *
 * 背景：server 侧 controller 全部写裸字面量路径、0 处消费 contract 常量；contract 里的常量
 * 与真实路由存在缺口（缺 controller 前缀、个别值没有路由支撑）。U2a 的判据是「字面量对齐」
 * 而不是完整路由表：
 *
 * ① 扫描面（纯 fs + 正则，零装载）：
 *    - `apps/api/src/**` 与 `libs/<lib>/src/**` 下的全部 `*.controller.ts`（新增 lib 自动纳入）；
 *    - 类级 `@Controller(...)`：支持无参（前缀 = ''）、单字面量（`'x'` / `"x"`）、
 *      `Group.KEY` 常量引用（按 contract/routes.ts 解析成值）、`'x', { ...options }`
 *      （options 与路径无关，本守卫只取路径，options 原文留在 catalog 里供报告）；
 *      **options-only（`@Controller({ path: 'x' })`）与数组路径不支持**；
 *    - 方法级 `@Get/@Post/@Put/@Patch/@Delete/@Options/@Head/@All`：支持无参（path = ''）、
 *      单字面量、`Group.KEY` 常量引用、`'x', { ...options }`（如 `{ version }`）；
 *      数组路径 / 计算路径 / 模板串 / 拼接路径不支持 —— 这些形态**不静默跳过**，直接
 *      `expect.fail` 并提示扩展扫描器。
 *
 *    常量引用（U2b 起 controller 前缀全部改引用）必须能在 contract/routes.ts 里解析到
 *    同名 `export const Group = { KEY: '值' }`；引用不存在的 `Group.KEY` 直接 fail（防拼错）。
 *    解析后仍走同一套对账 —— 参考值来自契约，对账的是「引用到的值 ↔ 真实路由」。
 *
 * ② fullPath 的拼接规则与 Nest 实际行为一致（`@nestjs/core/router/route-path-factory.js`
 *    的 `concatPaths = stripEndSlash(a) + addLeadingSlash(b)`）：
 *    `fullPath = addLeadingSlash(stripEndSlash(addLeadingSlash(prefix)) + addLeadingSlash(path))`，
 *    两段都为空时是 `/`。所以 `@Controller('security/cap')` + `@Post('/challenge')` =
 *    `/security/cap/challenge`（不是双斜杠），`@Controller()` + `@Get('deps')` = `/deps`。
 *    全局前缀（`setGlobalPrefix`）当前为 0 处，不在对账内；若将来引入，契约值与扫描器要同步。
 *
 * ③ 对账（三组断言）：
 *    a) 每条 fullPath 都被某个 contract 值**覆盖**：精确相等，或 contract 值是其段前缀
 *       （`fullPath.startsWith(value + '/')`）。覆盖允许「前缀常量兜底」—— 这正是 U2a 只补
 *       前缀级常量的原因；方法级命名端点按需再加。
 *    b) 反孤儿：每个 contract 值都被真实路由**锚定** —— 精确等于某 controller 前缀、精确等于
 *       某条 fullPath、是某条 fullPath 的段前缀（方法常量 ↔ 带参路由），或匹配某条带参路由
 *       的 pattern（`/app/key/current/AES_KEY_URL` ↔ `/app/key/current/:type`；参数段按
 *       `:name` 前缀识别，`:id(\\d+)` 这类路由约束只当通配段，不校验正则体）。
 *    c) 分组结构抽查：已知分组的值必须落在该分组域名下（`AppRoutes` 的 `/deps`、`/` 是显式
 *       例外）；新分组须登记 `ROUTE_GROUP_DOMAINS`；常量值全仓唯一。
 *
 * ④ 已知边界（扫描器刻意不覆盖的形态，兜底不是本守卫）：
 *    - **复合装饰器生成的路由**：`WalnutCrudDecorators(...)` 返回的 `WalnutAdminDecoratorCreate`
 *      / `Read` / `Update` / `Delete` / `List` 等通过 `applyDecorators(Post('list'), ...)`
 *      在库里挂方法元数据，controller 源文件里没有 `@Post('list')` 字面量 —— 扫不到。这些
 *      controller 由 controller 前缀常量兜底（断言 ① 强制每个前缀都有精确常量）。
 *    - 多行装饰器 / 换行拼接：本实现允许括号内换行与空白，但要求路径仍是单字面量或
 *      `Group.KEY` 常量引用；计算路径、其它变量、模板串、跨装饰器拼接一律 fail（不静默漏）。
 *    - Nest 的路由数组形态（`@Get(['a', 'b'])`）与 options-only 的 `@Controller` 不支持。
 *    - 路由真源的最终兜底仍是 `pnpm openapi:export`（CI 有零 diff 门禁）：本守卫的目标是
 *      「契约常量与 controller 字面量对齐」，不是替代完整路由表。
 *    - 两处已知盲区（评审 P3）：① 断言① 的前缀值对已常量化的 controller 是同源自洽
 *      （两侧一起改不会红），前缀值的真实改动由 openapi 零 diff 拦；② `Group.KEY` 按名字
 *      在 contract 内解析，不校验 controller 的 import 来源。
 *
 * 解析前先剥注释（字符串里的 `//` / `/*` 原样保留）—— 注释掉的旧路由不能参与对账。
 */

// ─── HTTP 谓词与路径形态 ─────────────────────────────────────────────────────────

const HTTP_VERB_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All'] as const

type HttpVerbDecorator = (typeof HTTP_VERB_DECORATORS)[number]

interface IRouteEntry {
  verb: HttpVerbDecorator
  /** 处理函数名（仅用于报错定位；复合装饰器的方法不进这里） */
  handler: string
  /** 方法装饰器的原始 path（可为空串） */
  path: string
  /** Nest 归一化后的完整路径（恒以 `/` 开头，除根 `/` 外无尾斜杠） */
  fullPath: string
}

interface IControllerCatalogEntry {
  file: string
  className: string
  /** 类级前缀（`@Controller()` = ''）；对账时归一化成 `/` 根 */
  prefix: string
  /** `@Controller('x', { ... })` 的第二参原文；无则 undefined */
  prefixOptions?: string
  /** 该 controller 里检测到的复合路由装饰器（路由不可见，仅报告） */
  compositeDecorators: string[]
  routes: IRouteEntry[]
}

interface IContractEntry {
  group: string
  key: string
  value: string
}

interface IContractGroup {
  name: string
  entries: IContractEntry[]
}

// ─── 文本工具（纯文本、零装载；与 lib-registration.drift.spec 同款剥注释）──────────

/**
 * 剥离 `//` 行注释与块注释（字符串 / 模板串内部的 `//` 与 `/*` 原样保留）。
 * 注释里的旧 `@Controller` / 路由字面量不能参与对账。
 */
function stripComments(text: string): string {
  let stripped = ''
  let quote: string | null = null

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (quote !== null) {
      stripped += char
      if (char === '\\') {
        stripped += text[++i] ?? ''
        continue
      }
      if (char === quote)
        quote = null
      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      stripped += char
      continue
    }

    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n')
        i++
      stripped += '\n'
      continue
    }

    if (char === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/'))
        i++
      i++
      stripped += ' '
      continue
    }

    stripped += char
  }

  return stripped
}

/** 读取从 start 起的字符串字面量（单/双引号，处理反斜杠转义） */
function readStringLiteral(text: string, start: number): { value: string, endIndex: number } {
  const quote = text[start]
  if (quote !== '\'' && quote !== '"')
    expect.fail(`期望字符串字面量，实际字符：${JSON.stringify(text[start])}`)

  let value = ''
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      value += text[i + 1] ?? ''
      i++
      continue
    }
    if (text[i] === quote)
      return { value, endIndex: i + 1 }
    value += text[i]
  }

  expect.fail('字符串字面量没有闭合')
}

/** 从 `(` 位置起找到配对的 `)`（跳过字符串内部；支持嵌套括号 / 对象 / 数组） */
function findMatchingParen(text: string, openParenIndex: number): number {
  let depth = 0
  let quote: string | null = null

  for (let i = openParenIndex; i < text.length; i++) {
    const char = text[i]

    if (quote !== null) {
      if (char === '\\')
        i++
      else if (char === quote)
        quote = null
      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === '(') {
      depth++
      continue
    }

    if (char === ')') {
      depth--
      if (depth === 0)
        return i
    }
  }

  expect.fail('装饰器括号不配对（扫描器输入被截断？）')
}

/**
 * 读取路径参数：字符串字面量，或 `Group.KEY` 形式的 contract 常量引用。
 * 常量引用必须能在 contract/routes.ts 里解析到 —— 否则 fail（拼错不能静默漏）。
 * 数组 / 计算表达式 / 模板串 / 其它变量一律 fail。
 */
function readPathArgument(
  text: string,
  start: number,
  label: string,
  contractRefs: ReadonlyMap<string, string>,
): { value: string, endIndex: number } {
  if (text[start] === '\'' || text[start] === '"')
    return readStringLiteral(text, start)

  const reference = /^([A-Za-z_$][\w$]*)\.([A-Z][A-Z0-9_]*)\b/.exec(text.slice(start))
  if (reference === null) {
    expect.fail(
      `${label} 的路径既不是字符串字面量也不是 Group.KEY 常量引用`
      + '（模板串 / 变量 / 计算路径不在覆盖内；请扩展扫描器）',
    )
  }

  const refName = `${reference[1]}.${reference[2]}`
  const resolved = contractRefs.get(refName)
  if (resolved === undefined) {
    expect.fail(`${label} 引用了 contract/routes.ts 中不存在的常量 ${refName}（拼错 / 分组名写错？）`)
  }

  return { value: resolved, endIndex: start + reference[0].length }
}

interface IParsedCallArguments {
  /** 第一参：路径字面量（无参形态为 undefined） */
  firstArgument?: string
  /** 第二参起原文（Nest 的 options 形态）；无则为 undefined */
  trailingOptions?: string
  /** 闭 `)` 之后的下标 */
  endIndex: number
}

/**
 * 解析装饰器参数：只接受「空参 / 单字面量或 Group.KEY 引用 / 前者 + options」三种形态。
 * 数组、计算表达式、模板串、拼接一律 fail —— 不允许静默漏路由。
 */
function parseCallArguments(
  text: string,
  openParenIndex: number,
  label: string,
  contractRefs: ReadonlyMap<string, string>,
): IParsedCallArguments {
  const closeIndex = findMatchingParen(text, openParenIndex)
  let i = openParenIndex + 1

  while (i < text.length && /\s/.test(text[i]))
    i++

  if (i === closeIndex)
    return { endIndex: closeIndex + 1 }

  if (text[i] === '[') {
    expect.fail(`${label} 用了数组路径形态（本守卫不支持；请扩展扫描器而不是绕过）`)
  }

  const argument = readPathArgument(text, i, label, contractRefs)
  i = argument.endIndex

  while (i < text.length && /\s/.test(text[i]))
    i++

  if (i === closeIndex)
    return { firstArgument: argument.value, endIndex: closeIndex + 1 }

  if (text[i] !== ',') {
    expect.fail(`${label} 的路径表达式无法解析（只支持单字面量或字面量 + options）`)
  }

  const trailingOptions = text.slice(i + 1, closeIndex).trim()
  return { firstArgument: argument.value, trailingOptions, endIndex: closeIndex + 1 }
}

/** 装饰器里的路径只允许字面量段；内部双斜杠会让 Nest 原样保留，对账口径会失真 */
function normalizeDecoratorPath(raw: string, label: string): string {
  if (raw.includes('//'))
    expect.fail(`${label} 的路径出现连续斜杠：${JSON.stringify(raw)}`)
  if (raw.includes('?') || raw.includes('#'))
    expect.fail(`${label} 的路径带 query / hash：${JSON.stringify(raw)}（路由定义不应包含它们）`)
  return raw
}

/**
 * Nest `RoutePathFactory` 的拼接：
 * `concatPaths(a, b) = stripEndSlash(a) + addLeadingSlash(b)`，
 * 任一段为空则跳过（`@Controller()` = ''；`@Get()` = ''），最后 `addLeadingSlash(path || '/')`
 * 并去掉非根路径的尾斜杠。
 */
function nestJoinPath(prefix: string, methodPath: string): string {
  const stripEndSlash = (path: string): string => path.endsWith('/') ? path.slice(0, -1) : path
  const addLeadingSlash = (path: string): string => {
    if (path === '')
      return ''
    return path.startsWith('/') ? path : `/${path}`
  }
  const concatPaths = (left: string, right: string): string => stripEndSlash(left) + addLeadingSlash(right)

  let joined = ''
  if (prefix !== '')
    joined = concatPaths(joined, prefix)
  if (methodPath !== '')
    joined = concatPaths(joined, methodPath)

  const withLeading = addLeadingSlash(joined === '' ? '/' : joined)
  return withLeading === '/' ? withLeading : stripEndSlash(withLeading)
}

// ─── controller 扫描 ─────────────────────────────────────────────────────────────

function listControllerFiles(dir: string): string[] {
  const found: string[] = []
  if (!existsSync(dir))
    return found

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...listControllerFiles(full))
    }
    else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
      found.push(full)
    }
  }
  return found
}

/** 扫描面：app 侧 modules + 全部 lib 的 `src`（新增 lib 自动纳入，不维护清单） */
function listAllControllerFiles(): string[] {
  const appFiles = listControllerFiles(resolve(process.cwd(), 'apps/api/src'))
  const libsRoot = resolve(process.cwd(), 'libs')
  const libFiles = readdirSync(libsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => listControllerFiles(join(libsRoot, entry.name, 'src')))

  return [...appFiles, ...libFiles].sort()
}

/** 复合路由装饰器：路由由库里的 applyDecorators 生成，controller 文件里没有字面量可扫 */
const COMPOSITE_ROUTE_HELPERS = [
  'WalnutCrudDecorators',
  'applyDecorators',
  'WalnutAdminDecoratorCreate',
  'WalnutAdminDecoratorRead',
  'WalnutAdminDecoratorUpdate',
  'WalnutAdminDecoratorDelete',
  'WalnutAdminDecoratorDeleteMany',
  'WalnutAdminDecoratorList',
] as const

/** 跳过 route 装饰器之后的其它装饰器（`@HttpCode` / `@UseGuards` ...），读到方法名 */
function readHandlerName(text: string, fromIndex: number): string {
  let index = fromIndex

  for (;;) {
    while (index < text.length && /\s/.test(text[index]))
      index++

    if (text[index] !== '@')
      break

    const nameMatch = /^@[$_a-z][\w$]*/i.exec(text.slice(index))
    if (nameMatch === null)
      break
    index += nameMatch[0].length

    while (index < text.length && /\s/.test(text[index]))
      index++

    if (text[index] === '(')
      index = findMatchingParen(text, index) + 1
  }

  const match = /^(?:(?:public|private|protected|static|async|readonly|override)\s+)*([A-Za-z_$][\w$]*)\s*\(/.exec(text.slice(index))
  return match === null ? '<unknown>' : match[1]
}

function readClassName(text: string, fromIndex: number): string {
  const rest = text.slice(fromIndex)
  const match = /class\s+([A-Za-z_$][\w$]*)/.exec(rest)
  return match === null ? '<unknown>' : match[1]
}

function parseControllerFile(file: string, contractRefs: ReadonlyMap<string, string>): IControllerCatalogEntry {
  const label = relative(process.cwd(), file).split(sep).join('/')
  const text = stripComments(readFileSync(file, 'utf8'))

  const controllerMatches = [...text.matchAll(/@Controller\s*\(/g)]
  if (controllerMatches.length !== 1) {
    expect.fail(
      `${label}: 应恰有 1 个 @Controller（实际 ${controllerMatches.length} 个）。`
      + '多 controller 文件 / 注释残留会让本守卫失效，请拆分或扩展扫描器',
    )
  }

  const [controllerMatch] = controllerMatches
  const controllerOpenParen = (controllerMatch.index ?? 0) + controllerMatch[0].length - 1
  const controllerArgs = parseCallArguments(text, controllerOpenParen, `${label} 的 @Controller`, contractRefs)
  const prefix = normalizeDecoratorPath(controllerArgs.firstArgument ?? '', `${label} 的 @Controller`)

  const compositeDecorators = COMPOSITE_ROUTE_HELPERS
    .filter(helper => text.includes(`${helper}(`))

  const routes: IRouteEntry[] = []
  const routePattern = new RegExp(`@(${HTTP_VERB_DECORATORS.join('|')})\\s*\\(`, 'g')
  for (const routeMatch of text.matchAll(routePattern)) {
    const verb = routeMatch[1] as HttpVerbDecorator
    const openParen = (routeMatch.index ?? 0) + routeMatch[0].length - 1
    const args = parseCallArguments(text, openParen, `${label} 的 @${verb}`, contractRefs)
    const methodPath = normalizeDecoratorPath(args.firstArgument ?? '', `${label} 的 @${verb}`)

    routes.push({
      verb,
      handler: readHandlerName(text, args.endIndex),
      path: methodPath,
      fullPath: nestJoinPath(prefix, methodPath),
    })
  }

  return {
    file: label,
    className: readClassName(text, (controllerMatch.index ?? 0) + controllerMatch[0].length),
    prefix,
    prefixOptions: controllerArgs.trailingOptions,
    compositeDecorators,
    routes,
  }
}

// ─── contract/routes.ts 解析 ────────────────────────────────────────────────────

const CONTRACT_ROUTES_FILE = resolve(process.cwd(), '../../packages/platform-any/contract/src/routes.ts')

/** 契约值必须是单字面量绝对路径：前面无 query/hash、无连续斜杠、非根无尾斜杠 */
function normalizeContractPath(raw: string, label: string): string {
  if (!raw.startsWith('/'))
    expect.fail(`${label} 的值必须以 / 开头（实际 ${JSON.stringify(raw)}）`)
  if (raw.includes('//'))
    expect.fail(`${label} 的值出现连续斜杠：${JSON.stringify(raw)}`)
  if (raw.includes('?') || raw.includes('#'))
    expect.fail(`${label} 的值带 query / hash：${JSON.stringify(raw)}`)
  if (raw.length > 1 && raw.endsWith('/'))
    expect.fail(`${label} 的值不应以 / 结尾：${JSON.stringify(raw)}`)
  return raw
}

/**
 * 只支持现有文件形态：`export const XxxRoutes = { KEY: 'literal', ... } as const`。
 * 分组体的每一非空行必须是 `KEY: '字面量'` —— 计算值 / spread / 模板串直接 fail，
 * 不给「解析半截」留静默通道。
 */
function parseContractGroups(text: string): IContractGroup[] {
  const stripped = stripComments(text)
  const groups: IContractGroup[] = []

  for (const groupMatch of stripped.matchAll(/export const (\w+) = \{([\s\S]*?)\} as const/g)) {
    const name = groupMatch[1]
    const body = groupMatch[2]
    const entries: IContractEntry[] = []

    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed === ',')
        continue

      const entry = /^([A-Z][A-Z0-9_]*)\s*:\s*'([^']*)'\s*,?$/.exec(trimmed)
      if (entry === null) {
        expect.fail(
          `contract/routes.ts 的 ${name} 分组里出现无法解析的条目：${trimmed}`
          + '（本守卫只支持 KEY: \'字面量\' 单行形态；计算值 / spread 请扩展扫描器）',
        )
      }

      entries.push({
        group: name,
        key: entry[1],
        value: normalizeContractPath(entry[2], `${name}.${entry[1]}`),
      })
    }

    groups.push({ name, entries })
  }

  if (groups.length === 0)
    expect.fail('contract/routes.ts 里没有解析到任何 `export const XxxRoutes = { ... } as const` 分组')

  return groups
}

// ─── 对账判定（纯函数，供篡改自测复用）──────────────────────────────────────────

function controllerPrefixOf(entry: IControllerCatalogEntry): string {
  if (entry.prefix === '')
    return '/'
  // Nest 的 addLeadingSlash：`@Controller('auth')` 的路由前缀是 `/auth`
  return entry.prefix.startsWith('/') ? entry.prefix : `/${entry.prefix}`
}

/** 路径段拆分；根 `/` 是空段集 */
function pathSegments(path: string): string[] {
  return path === '/' ? [] : path.split('/').filter(Boolean)
}

/** 带参路由 pattern 与具体路径匹配（`:name` / `:name(regex)` 都按单段通配） */
function matchesRoutePattern(concrete: string, pattern: string): boolean {
  const concreteSegments = pathSegments(concrete)
  const patternSegments = pathSegments(pattern)
  if (concreteSegments.length !== patternSegments.length)
    return false

  return patternSegments.every((segment, index) =>
    segment.startsWith(':') ? concreteSegments[index] !== '' : segment === concreteSegments[index],
  )
}

/** a) 路由覆盖：精确相等，或某常量值为其段前缀（根 `/` 只做精确匹配，避免它覆盖全部路由） */
function isRouteCovered(fullPath: string, contractValues: ReadonlySet<string>): boolean {
  if (fullPath === '/')
    return contractValues.has('/')

  for (const value of contractValues) {
    if (value === '/')
      continue
    if (fullPath === value || fullPath.startsWith(`${value}/`))
      return true
  }
  return false
}

/** b) 契约锚定：controller 前缀 / 路由精确值 / 路由段前缀 / 带参路由 pattern */
function isContractValueAnchored(
  value: string,
  controllerPrefixes: ReadonlySet<string>,
  routeFullPaths: readonly string[],
): boolean {
  if (controllerPrefixes.has(value))
    return true

  if (value === '/')
    return false

  return routeFullPaths.some(route =>
    route === value
    || route.startsWith(`${value}/`)
    || matchesRoutePattern(value, route),
  )
}

function collectPrefixProblems(catalog: IControllerCatalogEntry[], contractEntries: IContractEntry[]): string[] {
  const contractValues = new Set(contractEntries.map(entry => entry.value))
  const problems: string[] = []

  for (const entry of catalog) {
    const prefix = controllerPrefixOf(entry)
    if (!contractValues.has(prefix)) {
      problems.push(
        `controller 前缀 ${prefix}（${entry.file}#${entry.className}）在 contract/routes.ts 中没有精确相等的常量；`
        + '补一个前缀常量（U2a 只做前缀级，方法级命名端点按需再加）',
      )
    }
  }

  return problems
}

function collectRouteCoverageProblems(catalog: IControllerCatalogEntry[], contractEntries: IContractEntry[]): string[] {
  const contractValues = new Set(contractEntries.map(entry => entry.value))
  const problems: string[] = []

  for (const entry of catalog) {
    for (const route of entry.routes) {
      if (!isRouteCovered(route.fullPath, contractValues)) {
        problems.push(
          `路由 ${route.verb} ${route.fullPath}（${entry.file}#${route.handler}）没有任何 contract 常量覆盖；`
          + '补 controller 前缀常量或该方法的命名端点',
        )
      }
    }
  }

  return problems
}

function collectContractOrphanProblems(catalog: IControllerCatalogEntry[], contractEntries: IContractEntry[]): string[] {
  const controllerPrefixes = new Set(catalog.map(controllerPrefixOf))
  const routeFullPaths = catalog.flatMap(entry => entry.routes.map(route => route.fullPath))
  const problems: string[] = []

  for (const entry of contractEntries) {
    if (!isContractValueAnchored(entry.value, controllerPrefixes, routeFullPaths)) {
      problems.push(
        `contract 常量 ${entry.group}.${entry.key}=${entry.value} 不对应任何 controller 前缀 / 控制器字面量路由`
        + '（反孤儿：先确认路由是否真的不存在，再决定改契约还是补路由）',
      )
    }
  }

  return problems
}

/**
 * 分组结构抽查（弱断言）：已知分组的值落在各自域名下；新分组必须在这里登记域名。
 * 不校验「每个域恰好一个分组」—— 分组粒度是命名决策，不是机械事实。
 */
const ROUTE_GROUP_DOMAINS: Record<string, readonly string[]> = {
  AuthRoutes: ['/auth'],
  SystemRoutes: ['/system'],
  SystemEndpointRoutes: ['/system'],
  // AppRoutes 历史上混装了跨域端点：/deps 是根级依赖清单，/ 是 AppController 根
  AppRoutes: ['/app', '/deps', '/'],
  SecurityRoutes: ['/security'],
  SharedRoutes: ['/shared'],
}

function collectGroupStructureProblems(groups: IContractGroup[]): string[] {
  const problems: string[] = []
  const seenValues = new Map<string, string>()

  for (const group of groups) {
    if (group.entries.length === 0)
      problems.push(`contract 分组 ${group.name} 是空分组`)

    const domains = ROUTE_GROUP_DOMAINS[group.name]
    if (domains === undefined) {
      problems.push(`contract 分组 ${group.name} 未在 ROUTE_GROUP_DOMAINS 登记所属域名（分组结构抽查）`)
    }

    for (const entry of group.entries) {
      if (domains !== undefined) {
        const inDomain = domains.some(domain => domain === '/'
          ? entry.value === '/'
          : entry.value === domain || entry.value.startsWith(`${domain}/`))
        if (!inDomain) {
          problems.push(
            `contract 常量 ${entry.group}.${entry.key}=${entry.value} 不在该分组域名 [${domains.join(', ')}] 下`,
          )
        }
      }

      const previous = seenValues.get(entry.value)
      if (previous !== undefined) {
        problems.push(`contract 值 ${entry.value} 重复：${previous} 与 ${entry.group}.${entry.key}`)
      }
      else {
        seenValues.set(entry.value, `${entry.group}.${entry.key}`)
      }
    }
  }

  return problems
}

/** 全部判定合并（篡改自测与各断言共用同一套逻辑，避免自测跑另一条空转路径） */
function collectAllProblems(catalog: IControllerCatalogEntry[], contractText: string): string[] {
  const groups = parseContractGroups(contractText)
  const entries = groups.flatMap(group => group.entries)

  return [
    ...collectPrefixProblems(catalog, entries),
    ...collectRouteCoverageProblems(catalog, entries),
    ...collectContractOrphanProblems(catalog, entries),
    ...collectGroupStructureProblems(groups),
  ]
}

// ─── 用例 ────────────────────────────────────────────────────────────────────────

describe('路由目录 drift 守卫（controller 字面量路由 ↔ contract/routes.ts，纯 fs + 正则）', () => {
  const contractText = readFileSync(CONTRACT_ROUTES_FILE, 'utf8')
  const groups = parseContractGroups(contractText)
  const entries = groups.flatMap(group => group.entries)
  // `Group.KEY` → 值：controller 装饰器现在允许直接引用契约常量（U2b），解析后再对账
  const contractRefs = new Map(entries.map(entry => [`${entry.group}.${entry.key}`, entry.value]))
  const catalog = listAllControllerFiles().map(file => parseControllerFile(file, contractRefs))

  it('基础面非空（扫描面为空 / 解析全漏时，本守卫必须报警而不是静默通过）', () => {
    expect(catalog.length, '扫描到的 controller 文件数').toBeGreaterThan(0)
    expect(catalog.flatMap(entry => entry.routes).length, '扫描到的字面量方法路由数').toBeGreaterThan(0)
    expect(entries.length, 'contract/routes.ts 解析到的常量数').toBeGreaterThan(0)

    // 同一前缀两个 controller 会让「前缀常量」二义，且 Nest 里也是路由冲突
    const prefixes = catalog.map(controllerPrefixOf)
    const duplicated = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index)
    expect([...new Set(duplicated)], '重复的 controller 前缀').toEqual([])
  })

  it('① 每个 controller 前缀都有精确相等的 contract 常量（前缀级补缺的机械判据）', () => {
    expect(collectPrefixProblems(catalog, entries)).toEqual([])
  })

  it('② a) 每条 fullPath 都被 contract 常量覆盖（精确相等或段前缀）', () => {
    expect(collectRouteCoverageProblems(catalog, entries)).toEqual([])
  })

  it('② b) 反孤儿：每个 contract 常量都被 controller 前缀或字面量路由锚定', () => {
    expect(collectContractOrphanProblems(catalog, entries)).toEqual([])
  })

  it('② c) 分组结构抽查：域名对齐 + 值唯一 + 无空分组', () => {
    expect(collectGroupStructureProblems(groups)).toEqual([])
  })

  it('已知边界：复合装饰器 controller 的方法路由不在字面量扫描内，但仍须有前缀常量兜底', () => {
    const compositeControllers = catalog.filter(entry => entry.compositeDecorators.length > 0)
    expect(compositeControllers.length, '检测到的复合装饰器 controller 数').toBeGreaterThan(0)

    const contractValues = new Set(entries.map(entry => entry.value))
    const missing = compositeControllers
      .map(controllerPrefixOf)
      .filter(prefix => !contractValues.has(prefix))
    expect(missing, '复合装饰器 controller 缺前缀常量时，其生成路由在两侧都不可见').toEqual([])
  })

  it('对账自测：把 SystemRoutes.ROLE 改坏后必须报红（证明对账不是空转）', () => {
    const tampered = contractText.replace('ROLE: \'/system/role\'', 'ROLE: \'/system/role-typo\'')
    expect(tampered, '篡改锚点没命中（SystemRoutes.ROLE 改名了？同步本自测）').not.toBe(contractText)

    const problems = collectAllProblems(catalog, tampered)
    expect(
      problems.some(problem => problem.includes('controller 前缀 /system/role')),
      `篡改后必须报「前缀缺常量」，实际：${problems.join(' | ')}`,
    ).toBe(true)
    expect(
      problems.some(problem => problem.includes('SystemRoutes.ROLE=/system/role-typo')),
      `篡改后必须报「反孤儿」，实际：${problems.join(' | ')}`,
    ).toBe(true)
  })
})

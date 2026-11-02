import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * lib 注册一致性 drift 守卫 —— 防「目录在、注册漏」。
 *
 * 背景：`apps/server` 是 Nest CLI 内部 monorepo（ADR 0007），每个内部 lib 要在**多处配置里
 * 各登记一次**，且这些注册点互不联动 —— 漏一处不会让 `tsc` 报错，只会在**构建或运行期**炸
 * （SWC 的 `filenames` 漏了 → 产物里没有这个 lib，`@walnut-server/*` 运行时解析失败；
 * nest-cli `projects` 漏了 → `nest build <lib>` 无 project 可用（本仓无根 nest-cli.json，
 * 实测是静默 no-op）。历史上
 * `@walnut-server/context` 就漏了 nest-cli projects 注册（归档的 lib-extraction 计划交叉
 * 记录第 3 条），靠人肉记忆补不全，所以机械拦：
 *
 * 磁盘真源：`libs/<name>`（必须含 `src/index.ts` + `tsconfig.lib.json`）。
 * 注册面（全部必须与磁盘集合相等）：
 * ① `tsconfig.json` → `compilerOptions.paths` 的 `@walnut-server/<name>`（含 `/*` 变体）；
 * ② `infra/nest/{dev,prod,stage}.json` → `compilerOptions.builder.options.filenames` 的
 *    `libs/<name>/src`，以及 `projects` 里每个 lib 的标准形状（application 项目 —— api /
 *    cli / worker 这些组合入口 —— 不参与本守卫）；
 * ③ `infra/swc/{dev,prod,stage}.swcrc` → `jsc.paths` 的 `@walnut-server/<name>`（值指向
 *    `libs/<name>/src`）；
 * ④ `apps/api/tsconfig.app.json` → `include` 的 `../../libs/<name>/src` 全量 glob 条目（app
 *    构建的 TS 程序要看见每个 lib；build:libs 脚本因 no-op 已删除，不再作为注册面）；
 * ⑤ `eslint.config.ts` → `INFRA_LIBS` / `TECH_BASE_LIBS` / `TECH_ASSEMBLE_LIBS` / `DOMAIN_LIBS` /
 *    `TOP_LIBS` / `EXCEPTION_LIBS` 六份分层名单（守的是入边方向：新增 lib 必须归入一个分层，否则
 *    lint 的 fail-closed 配置会拦它的出边，但「有人把 lib 建在磁盘上却没进任何一层」这种反向遗漏
 *    只有本守卫能查）；并从 `layer(name, libs, banned)` 的接线反推分层矩阵（lib 归属 + banned 集合
 *    必须与 rank 推导一致，防「名单对了、接线错了」的盲区）。解析前先剥注释；`layer(...)` 调用数
 *    固定为 10（9 层 + `infra-exceptions` 例外行）；`layer()` 函数体的 `files:` 派生式必须覆盖每个 lib 的
 *    `libs/<lib>/**` 下的全部 `.ts`（防函数体被改坏）；另有一条注入篡改自测
 *    （某层 banned 删一项必须报红，证明对账非空转）。
 *
 * 纯 fs + 静态文本，零依赖装载。新增 lib 的动作就是「建目录 + 五处登记」，漏任何一处本文件红。
 */

// ─── 配置形状（只声明本文件真正读到的字段）────────────────────────────────────────

interface ITsconfigJson {
  compilerOptions: {
    paths: Record<string, string[]>
  }
}

interface INestCliJson {
  compilerOptions: {
    builder: {
      options: {
        filenames: string[]
      }
    }
  }
  projects: Record<string, {
    type: string
    root: string
    sourceRoot: string
    entryFile: string
    compilerOptions: { tsConfigPath: string }
  }>
}

interface ISwcrcJson {
  jsc: {
    paths: Record<string, string[]>
  }
}

// ─── 读取与解析工具 ───────────────────────────────────────────────────────────────

/** vitest 从 apps/server 起（`test.root: './'`），与 dto-entity.drift.spec 的 cwd 口径一致 */
function readServerFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readServerFile(relativePath)) as T
}

/** 磁盘真源：libs/ 下每个含 src/index.ts 的目录名（排序后作对账基准） */
function readActualLibNames(): string[] {
  const libsRoot = resolve(process.cwd(), 'libs')
  return readdirSync(libsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => existsSync(resolve(libsRoot, name, 'src', 'index.ts')))
    .sort()
}

/** `@walnut-server/<name>` 键集合（剥掉命名空间前缀与 `/*` 子路径变体，排序后比较） */
function aliasLibNames(paths: Record<string, string[]>): string[] {
  return [...new Set(
    Object.keys(paths)
      .filter(key => key.startsWith('@walnut-server/'))
      .map(key => key.replace(/^@walnut-server\//, '').replace(/\/\*$/, '')),
  )].sort()
}

const NEST_CLI_CONFIGS = ['infra/nest/dev.json', 'infra/nest/prod.json', 'infra/nest/stage.json'] as const
const SWCRC_CONFIGS = ['infra/swc/dev.swcrc', 'infra/swc/prod.swcrc', 'infra/swc/stage.swcrc'] as const

// ─── eslint.config.ts 分层接线解析（纯文本，零装载）────────────────────────────────

/** 分层名单常量：exceptions 单独一条例外行，不并入 INFRA_LIBS（每个 lib 恰好登记一次） */
const LAYER_LIST_NAMES = ['INFRA_LIBS', 'TECH_BASE_LIBS', 'TECH_ASSEMBLE_LIBS', 'DOMAIN_LIBS', 'TOP_LIBS', 'EXCEPTION_LIBS'] as const

/**
 * 剥离 `//` 行注释与 `/* *\/` 块注释（字符串 / 模板串内部的 `//` 与 `/*` 原样保留）。
 *
 * 解析前必须先剥：守卫自己要读的 `layer(...)` 与名单在注释里也有示例文本，
 * 注释掉的旧接线不能参与对账（否则「注释里留一份旧 layer 调用」就能骗过调用数断言）。
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

/** 读取五个单行字面量数组；读不到直接 fail（改名 / 跨行 / 计算式都不能让守卫静默失效） */
function readLayerLists(configText: string): Record<string, string[] | undefined> {
  const text = stripComments(configText)
  const lists: Record<string, string[] | undefined> = {}
  for (const listName of LAYER_LIST_NAMES) {
    const match = new RegExp(`const ${listName} = \\[([^\\]]*)\\]`).exec(text)
    if (!match) {
      expect.fail(`eslint.config.ts 里找不到 ${listName} 的单行字面量数组（改名或改成跨行/计算式都会让本守卫失效）`)
    }
    const names = [...match[1].matchAll(/'([\w-]+)'/g)].map(literal => literal[1])
    expect(names.length, `${listName} 不能为空`).toBeGreaterThan(0)
    lists[listName] = names
  }
  return lists
}

/** 从 `(` 之后的 bodyStart 起扫描到配对的 `)`（跳过字符串字面量），返回括号内文本 */
function readParenBody(text: string, bodyStart: number): { body: string, endIndex: number } {
  let depth = 1
  let quote: string | null = null

  for (let i = bodyStart; i < text.length; i++) {
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
        return { body: text.slice(bodyStart, i), endIndex: i }
    }
  }

  expect.fail('eslint.config.ts 的 layer(...) 调用括号不配对')
}

/** 按顶层逗号切分调用参数（括号 / 方括号 / 对象字面量与字符串内部的逗号不算） */
function splitTopLevelArgs(body: string): string[] {
  const args: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''

  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (quote !== null) {
      current += char
      if (char === '\\') {
        current += body[++i] ?? ''
        continue
      }
      if (char === quote)
        quote = null
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '(' || char === '[' || char === '{') {
      depth++
      current += char
      continue
    }
    if (char === ')' || char === ']' || char === '}') {
      depth--
      current += char
      continue
    }
    if (char === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  if (current.trim() !== '')
    args.push(current.trim())
  return args
}

/**
 * 展开 layer(...) 的数组参数：支持名单标识符、名字面量数组、`...NAME` 与
 * `...NAME.filter(lib => lib !== 'x')` 四种形态；其他形态 fail（不静默跳过）。
 */
function expandLibExpression(expression: string, lists: Record<string, string[] | undefined>): string[] {
  const trimmed = expression.trim()

  if (!trimmed.startsWith('[')) {
    const list = lists[trimmed]
    if (!list)
      expect.fail(`layer 接线里出现未知名单标识符：${trimmed}`)
    return [...list]
  }

  const names: string[] = []
  for (const raw of trimmed.slice(1, -1).split(',')) {
    const part = raw.trim()
    if (part === '')
      continue

    if (part.startsWith('...')) {
      const rest = part.slice(3)
      const identifier = /^\w+/.exec(rest)?.[0]
      if (identifier === undefined)
        expect.fail(`layer 接线里出现无法解析的 spread：${part}`)
      const list = lists[identifier]
      if (!list)
        expect.fail(`layer 接线里 spread 了未知名单：${identifier}`)

      // 只认 `...NAME` 与 `...NAME.filter(x => x !== 'lit')`；其余后缀直接 fail（不静默跳过）
      const suffix = rest.slice(identifier.length)
      const cleaned = suffix.replace(/\.filter\([^)]*\)/, '').trim()
      if (cleaned !== '')
        expect.fail(`layer 接线里出现无法解析的数组元素：${part}`)
      const excluded = /!==\s*'([\w-]+)'/.exec(suffix)?.[1]
      names.push(...list.filter(name => name !== excluded))
      continue
    }

    const literal = /^'([\w-]+)'$/.exec(part)
    if (!literal)
      expect.fail(`layer 接线里出现无法解析的数组元素：${part}`)
    names.push(literal[1])
  }
  return names
}

interface ILayerCall {
  name: string
  libs: string[]
  banned: string[]
}

/** 从 `layer('name', libs, banned, label)` 调用里提取前三个参数 */
function parseLayerCall(args: string[], lists: Record<string, string[] | undefined>): ILayerCall {
  if (args.length !== 4)
    expect.fail(`layer(...) 调用应有 4 个参数，实际 ${args.length} 个：${args.join(', ')}`)

  const name = /^'([\w-]+)'$/.exec(args[0])
  if (!name)
    expect.fail(`layer(...) 的第一个参数应是字符串字面量：${args[0]}`)

  return {
    name: name[1],
    libs: expandLibExpression(args[1], lists),
    banned: expandLibExpression(args[2], lists),
  }
}

/** 从 eslint.config.ts 文本提取全部 `layer('name', libs, banned, label)` 调用（注释不参与） */
function readLayerCalls(configText: string, lists: Record<string, string[] | undefined>): ILayerCall[] {
  const text = stripComments(configText)
  const calls: ILayerCall[] = []
  const needle = 'layer('
  let from = 0

  for (;;) {
    const index = text.indexOf(needle, from)
    if (index < 0)
      break

    const bodyStart = index + needle.length
    from = bodyStart
    // 跳过函数定义 `function layer(name: ...)` 等非调用形态：调用第一参数必须是名字面量
    if (!/^\s*'/.test(text.slice(bodyStart)))
      continue

    const { body, endIndex } = readParenBody(text, bodyStart)
    calls.push(parseLayerCall(splitTopLevelArgs(body), lists))
    from = endIndex + 1
  }

  return calls
}

/** 定位指定 layer 调用的括号位置与参数（用于篡改自测；找不到返回 null） */
function findLayerCall(configText: string, layerName: string): { bodyStart: number, endIndex: number, args: string[] } | null {
  const text = stripComments(configText)
  const index = text.indexOf(`layer('${layerName}'`)
  if (index < 0)
    return null

  const bodyStart = index + 'layer('.length
  const { body, endIndex } = readParenBody(text, bodyStart)
  return { bodyStart, endIndex, args: splitTopLevelArgs(body) }
}

/** 从 start 起读到顶层的 `,` 或闭 `}`（跳过字符串 / 模板串内的符号），返回表达式文本 */
function readExpressionUntilTopLevelComma(text: string, start: number): string {
  let depth = 0
  let quote: string | null = null

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (quote !== null) {
      if (char === '\\') {
        i++
        continue
      }
      if (char === quote)
        quote = null
      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      depth++
      continue
    }

    if (char === ')' || char === ']') {
      depth--
      continue
    }

    if (char === '}') {
      if (depth === 0)
        return text.slice(start, i).trim()
      depth--
      continue
    }

    if (char === ',' && depth === 0)
      return text.slice(start, i).trim()
  }

  expect.fail('layer() 函数体的 files 表达式没有在顶层逗号 / 闭花括号处结束')
}

/**
 * `layer()` 函数体的 `files:` 派生式 —— 防函数体被改坏：每个 layer 的 files 必须覆盖
 * `libs/<lib>/**` 下的全部 `.ts`，派生式一旦被改窄（漏 lib / 换扩展名 / 固定成单 lib），
 * 分层规则覆盖的 lib 集合就会静默缩水。
 */
function readLayerHelperFilesExpression(configText: string): string {
  const text = stripComments(configText)
  const helperStart = text.indexOf('function layer(')
  if (helperStart < 0)
    expect.fail('eslint.config.ts 里找不到 layer() 函数定义')
  const filesIndex = text.indexOf('files:', helperStart)
  if (filesIndex < 0)
    expect.fail('layer() 函数体里找不到 files: 派生式')
  return readExpressionUntilTopLevelComma(text, filesIndex + 'files:'.length)
}

/** 从 `libs.map(lib => \`...\`)` 派生式解出 glob 模板；形状不符直接 fail（不静默跳过） */
function readFilesTemplate(filesExpression: string): string {
  const match = /^libs\.map\(lib => `([^`]*)`\)$/.exec(filesExpression.replace(/\s+/g, ' '))
  if (!match)
    expect.fail(`layer() 函数体的 files 派生式应是 libs.map(lib => \`...\`)，实际：${filesExpression}`)
  return match[1]
}

/** 把指定 layer 的第三参数（banned）改写成字面量数组 —— 供「注入篡改必红」自测 */
function rewriteLayerBanned(configText: string, layerName: string, banned: readonly string[]): string {
  const text = stripComments(configText)
  const call = findLayerCall(text, layerName)
  if (!call)
    expect.fail(`找不到 layer('${layerName}', ...) 调用`)
  if (call.args.length !== 4)
    expect.fail(`layer('${layerName}', ...) 应有 4 个参数，实际 ${call.args.length} 个`)

  const literal = `[${banned.map(name => `'${name}'`).join(', ')}]`
  const rewrittenArgs = call.args.map((arg, index) => index === 2 ? literal : arg)
  return `${text.slice(0, call.bodyStart)}${rewrittenArgs.join(', ')}${text.slice(call.endIndex)}`
}

/**
 * 分层矩阵（按名字序硬编码）：eslint.config.ts 是接线真源，本矩阵是「按 ADR 0022 应该长什么样」
 * 的独立表述。新增 lib 时两边都要改，忘了改哪边本守卫都会红。
 */
const LAYER_MATRIX = [
  { name: 'infra', libs: ['config', 'const', 'context', 'db', 'decorators', 'pipes', 'types', 'utils'] },
  // F-14 / Q8a：技术层拆「设施 / 装配内核」两条 —— rank 上 base 低于 assemble，
  // 允许边只有 assemble → base 单向（ip 不得引 crud/list 等内核 lib）。
  { name: 'tech-base', libs: ['als', 'blpath', 'cookie', 'crypto', 'delay', 'lock', 'queue', 'sse', 'cache', 'throttle', 'mailer', 'sms', 'rsa', 'ip'] },
  { name: 'tech-assemble', libs: ['repository', 'list', 'crud', 'scope-resolver', 'token'] },
  { name: 'identity', libs: ['identity'] },
  { name: 'system', libs: ['system'] },
  { name: 'auth', libs: ['auth'] },
  { name: 'security', libs: ['security'] },
  { name: 'guards', libs: ['guards'] },
  { name: 'app-domain', libs: ['app-domain'] },
] as const

/** exceptions 与 infra 同 rank，唯一例外是允许 blpath（异常过滤器需要 skip 名单）。 */
const EXCEPTION_LAYER = {
  name: 'infra-exceptions',
  rank: 0,
  libs: ['exceptions'],
  allowedExtra: ['blpath'],
} as const

/** `layer()` 函数体的 files 派生式应生成的 glob 模板（模板变量名固定为 `lib`） */
const EXPECTED_FILES_TEMPLATE = `libs/\${lib}/**/*.ts`

/**
 * 接线对账的纯函数形态（空数组 = 通过）：调用数 / files 派生式 / lib 归属 / banned 集合
 * 全部按 LAYER_MATRIX 校验。抽成函数是为了「注入篡改必红」自测能跑同一套判定 ——
 * 篡改过的文本必须让本函数返回问题，而不是静默通过。
 */
function collectWiringProblems(configText: string): string[] {
  const lists = readLayerLists(configText)
  const calls = readLayerCalls(configText, lists)
  const problems: string[] = []

  // a) layer(...) 调用数固定为 9 层 + infra-exceptions 例外行（注释里的示例文本已被剥掉）
  if (calls.length !== 10)
    problems.push(`layer(...) 调用数应为 10（9 层 + infra-exceptions），实际 ${calls.length}`)

  // b) 每层 files ≡ 该层每个 lib 的 `libs/<lib>/**` 全部 `.ts`：layer() 函数体的派生式被改窄时这里红
  const filesTemplate = readFilesTemplate(readLayerHelperFilesExpression(configText))
  if (filesTemplate !== EXPECTED_FILES_TEMPLATE)
    problems.push(`layer() 函数体的 files 模板 [${filesTemplate}] 应为 [${EXPECTED_FILES_TEMPLATE}]`)
  for (const call of calls) {
    const files = call.libs.map(lib => filesTemplate.replace(/\$\{lib\}/g, lib))
    const expected = call.libs.map(lib => `libs/${lib}/**/*.ts`)
    if (JSON.stringify(files) !== JSON.stringify(expected))
      problems.push(`layer ${call.name} 的 files [${files.join(', ')}] ≠ libs/<lib>/**/*.ts 全集`)
  }

  // c) layer 调用顺序与矩阵（名字序）一致；exceptions 是唯一的精确例外行
  const nonExceptionCalls = calls.filter(call => call.name !== EXCEPTION_LAYER.name)
  const actualLayerNames = nonExceptionCalls.map(call => call.name)
  if (JSON.stringify(actualLayerNames) !== JSON.stringify(LAYER_MATRIX.map(row => row.name)))
    problems.push(`layer 调用顺序 [${actualLayerNames.join(', ')}] ≠ 矩阵 [${LAYER_MATRIX.map(row => row.name).join(', ')}]`)

  // fail-closed 的 libsBoundaryConfig 不是 layer(...) 形态，不在本对账内；每个 lib 必须恰好登记一次
  const layerLibs = calls.flatMap(call => call.libs)
  const duplicateLibs = layerLibs.filter((name, index) => layerLibs.indexOf(name) !== index)
  if (duplicateLibs.length > 0)
    problems.push(`同一 lib 出现在多个 layer 的 libs 数组：${[...new Set(duplicateLibs)].join(', ')}`)

  const matrixLibs = [...LAYER_MATRIX.flatMap(row => row.libs), ...EXCEPTION_LAYER.libs].sort()
  if (JSON.stringify([...new Set(layerLibs)].sort()) !== JSON.stringify(matrixLibs))
    problems.push(`layer libs 并集 [${[...new Set(layerLibs)].sort().join(', ')}] ≠ 矩阵 [${matrixLibs.join(', ')}]`)

  // 每层的 libs ≡ 矩阵对应行；exceptions 行单独对账
  for (const row of LAYER_MATRIX) {
    const call = calls.find(item => item.name === row.name)
    if (!call) {
      problems.push(`找不到 layer('${row.name}', ...) 调用`)
      continue
    }
    if (JSON.stringify([...call.libs].sort()) !== JSON.stringify([...row.libs].sort()))
      problems.push(`layer ${row.name} 的 libs [${call.libs.join(', ')}] ≠ 矩阵 [${row.libs.join(', ')}]`)
  }
  const exceptionCall = calls.find(call => call.name === EXCEPTION_LAYER.name)
  if (!exceptionCall) {
    problems.push(`找不到 layer('${EXCEPTION_LAYER.name}', ...) 调用`)
  }
  else if (JSON.stringify([...exceptionCall.libs].sort()) !== JSON.stringify([...EXCEPTION_LAYER.libs].sort())) {
    problems.push(`layer ${EXCEPTION_LAYER.name} 的 libs [${exceptionCall.libs.join(', ')}] ≠ 矩阵 [${EXCEPTION_LAYER.libs.join(', ')}]`)
  }

  // d) 每层 banned ≡ rank(target) > rank(source) 的全部 lib（exceptions 例外行再减 allowedExtra）
  const rankOf = (name: string): number =>
    name === EXCEPTION_LAYER.name
      ? EXCEPTION_LAYER.rank
      : LAYER_MATRIX.findIndex(row => row.name === name)

  for (const call of calls) {
    const rank = rankOf(call.name)
    if (rank < 0) {
      problems.push(`未知 layer：${call.name}`)
      continue
    }

    const expected = [...new Set(
      LAYER_MATRIX.slice(rank + 1)
        .flatMap(row => row.libs)
        .filter(lib => !(call.name === EXCEPTION_LAYER.name && (EXCEPTION_LAYER.allowedExtra as readonly string[]).includes(lib))),
    )].sort()
    const actual = [...call.banned].sort()

    if (new Set(call.banned).size !== call.banned.length)
      problems.push(`layer ${call.name} 的 banned 有重复项：[${call.banned.join(', ')}]`)
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      problems.push(`layer ${call.name} 的 banned [${actual.join(', ')}] ≠ 矩阵推导 [${expected.join(', ')}]`)
  }

  return problems
}

// ─── 用例 ────────────────────────────────────────────────────────────────────────

describe('lib 注册一致性 drift 守卫（libs 目录 ↔ 五处注册面，纯 fs，零装载）', () => {
  const actualLibs = readActualLibNames()

  it('磁盘真源非空（libs/ 目录没了或全部漏建 index.ts 时，本守卫必须失效报警而不是静默通过）', () => {
    expect(actualLibs.length).toBeGreaterThan(0)
  })

  it('每个 lib 都有 tsconfig.lib.json（nest-cli projects 的 tsConfigPath 指向它）', () => {
    const missing = actualLibs.filter(name => !existsSync(resolve(process.cwd(), 'libs', name, 'tsconfig.lib.json')))
    expect(missing, '缺 tsconfig.lib.json 的 lib').toEqual([])
  })

  it('① tsconfig.json paths ≡ 磁盘 libs（键集合 + 值指向 libs/<name>/src）', () => {
    const tsconfig = readJson<ITsconfigJson>('tsconfig.json')
    const paths = tsconfig.compilerOptions.paths
    expect(aliasLibNames(paths)).toEqual(actualLibs)

    // 键集合相等挡不住「键对了、值指错」（例如复制粘贴后值仍指向别的 lib）：
    // 逐个别名断言值恰好是它自己的源码目录，`/*` 变体同理。
    const problems: string[] = []
    for (const name of actualLibs) {
      const rootAlias = `@walnut-server/${name}`
      const subAlias = `@walnut-server/${name}/*`
      const rootTargets = paths[rootAlias]
      const subTargets = paths[subAlias]

      if (JSON.stringify(rootTargets) !== JSON.stringify([`./libs/${name}/src`]))
        problems.push(`${rootAlias} 应指向 [./libs/${name}/src]，实际 ${JSON.stringify(rootTargets)}`)
      if (JSON.stringify(subTargets) !== JSON.stringify([`./libs/${name}/src/*`]))
        problems.push(`${subAlias} 应指向 [./libs/${name}/src/*]，实际 ${JSON.stringify(subTargets)}`)
    }

    expect(problems).toEqual([])
  })

  it('② 三份 nest-cli json 的 filenames ≡ 磁盘 libs，且 projects 登记形状标准', () => {
    const problems: string[] = []

    for (const configPath of NEST_CLI_CONFIGS) {
      const config = readJson<INestCliJson>(configPath)

      const filenames = config.compilerOptions.builder.options.filenames
        .map(entry => /^libs\/([\w-]+)\/src$/.exec(entry)?.[1])
        .filter((name): name is string => name !== undefined)
        .sort()
      if (JSON.stringify(filenames) !== JSON.stringify(actualLibs)) {
        problems.push(`${configPath} filenames [${filenames.join(', ')}] ≠ 磁盘 [${actualLibs.join(', ')}]`)
      }

      // application（api / cli / worker 组合入口）不参与 lib 对账，但必须存在且形状标准 ——
      // 整段被删时门禁要红（批 10 评审补）
      const projectNames = Object.entries(config.projects)
        .filter(([, project]) => project.type !== 'application')
        .map(([name]) => name)
        .sort()
      if (JSON.stringify(projectNames) !== JSON.stringify(actualLibs)) {
        problems.push(`${configPath} projects（除 application）[${projectNames.join(', ')}] ≠ 磁盘 [${actualLibs.join(', ')}]`)
      }

      for (const [name, project] of Object.entries(config.projects)) {
        if (project.type === 'application') {
          // 组合入口（api / cli / worker）必须存在且 root 正确 —— 整段被删时门禁要红（批 10 评审补）
          if (!['api', 'cli', 'worker'].includes(name)) {
            problems.push(`${configPath} 出现未知 application project：${name}`)
          }
          if (project.root !== `apps/${name}` || project.sourceRoot !== `apps/${name}/src`) {
            problems.push(`${configPath} projects.${name} 的 root/sourceRoot 应为 apps/${name}（/src）`)
          }
          continue
        }
        if (project.type !== 'library') {
          problems.push(`${configPath} projects.${name}.type 应为 library，实际 ${project.type}`)
        }
        if (project.root !== `libs/${name}` || project.sourceRoot !== `libs/${name}/src`) {
          problems.push(`${configPath} projects.${name} 的 root/sourceRoot 应为 libs/${name}（/src）`)
        }
        if (project.entryFile !== 'index') {
          problems.push(`${configPath} projects.${name}.entryFile 应为 index（要求 src/index.ts 存在）`)
        }
        if (project.compilerOptions.tsConfigPath !== `libs/${name}/tsconfig.lib.json`) {
          problems.push(`${configPath} projects.${name}.tsConfigPath 应为 libs/${name}/tsconfig.lib.json`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('③ 三份 swcrc 的 paths ≡ 磁盘 libs，且值指向对应 libs/<name>/src', () => {
    const problems: string[] = []

    for (const swcrcPath of SWCRC_CONFIGS) {
      const swcrc = readJson<ISwcrcJson>(swcrcPath)

      if (JSON.stringify(aliasLibNames(swcrc.jsc.paths)) !== JSON.stringify(actualLibs)) {
        problems.push(`${swcrcPath} paths ≠ 磁盘 libs`)
      }

      for (const name of actualLibs) {
        const targets = swcrc.jsc.paths[`@walnut-server/${name}`]
        const normalized = (targets ?? []).map(target => target.replace(/^\.\//, ''))
        if (JSON.stringify(normalized) !== JSON.stringify([`libs/${name}/src`])) {
          problems.push(`${swcrcPath} 的 @walnut-server/${name} 应指向 libs/${name}/src，实际 [${(targets ?? []).join(', ')}]`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('④ apps/api/tsconfig.app.json include ≡ 磁盘 libs（app 构建的 TS 程序要看见每个 lib）', () => {
    const appTsconfig = readJson<{ include: string[] }>('apps/api/tsconfig.app.json')
    const libIncludes = appTsconfig.include
      .map(entry => /^\.\.\/\.\.\/libs\/([\w-]+)\/src\/\*\*\/\*$/.exec(entry)?.[1])
      .filter((name): name is string => name !== undefined)
      .sort()
    expect(libIncludes).toEqual(actualLibs)
  })

  it('⑤ eslint.config.ts 的分层名单（含 exceptions 例外行）并集 ≡ 磁盘 libs，且无重复', () => {
    const configText = readServerFile('eslint.config.ts')
    const lists = readLayerLists(configText)

    const collected = Object.values(lists).flat()
    const duplicates = collected.filter((name, index) => collected.indexOf(name) !== index)
    expect(duplicates, '同一 lib 被登记进多个分层（或同一层里重复）').toEqual([])
    expect([...new Set(collected)].sort(), 'eslint 分层名单并集').toEqual(actualLibs)
  })

  it('⑤ 接线对账：layer(...) 调用数 = 10，lib 归属 / banned 集合 / files 派生式 ≡ 分层矩阵', () => {
    const configText = readServerFile('eslint.config.ts')
    const calls = readLayerCalls(configText, readLayerLists(configText))
    expect(calls.length, 'layer(...) 调用数（9 层 + infra-exceptions 例外行；注释里的示例不算）').toBe(10)
    expect(collectWiringProblems(configText)).toEqual([])
  })

  it('⑤ 接线对账自测：把 tech-base 层 banned 删一项后必须报红（证明对账不是空转）', () => {
    const configText = readServerFile('eslint.config.ts')
    const calls = readLayerCalls(configText, readLayerLists(configText))
    const techBaseCall = calls.find(call => call.name === 'tech-base')
    if (!techBaseCall)
      expect.fail('找不到 tech-base 层')
    expect(techBaseCall.banned.length).toBeGreaterThan(1)

    // 篡改文本：banned 从「名单 spread」变成缺一项的字面量数组 —— 判定必须发现 banned ≠ 矩阵推导
    const tamperedText = rewriteLayerBanned(configText, 'tech-base', techBaseCall.banned.slice(1))
    const problems = collectWiringProblems(tamperedText)
    expect(problems.some(problem => problem.includes('tech-base') && problem.includes('banned'))).toBe(true)
  })
})

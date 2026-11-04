/**
 * 「新增一个后端内部 lib」的**注册面**：一条命令改完 12 个既有文件 + 建 2 个新文件。
 *
 * ## 为什么需要它
 *
 * `apps/server` 是 Nest CLI 内部 monorepo（ADR 0007）：一个 lib 要在**多处配置里各登记一次**，
 * 而这些注册点**互不联动** —— 漏一处不会让 `tsc` 报错，只在构建或运行期炸（SWC `filenames`
 * 漏了 → 产物里没有这个 lib；nest-cli `projects` 漏了 → `nest build <lib>` 静默 no-op）。
 * 历史上 `@walnut-server/als`（那时还叫 `libs/context`，D13② 已并入 `libs/als`）就漏过
 * nest-cli projects。守门人是
 * `apps/server/apps/api/src/common/monorepo/__tests__/lib-registration.drift.spec.ts`，
 * 但它只**报红**、不替你改 —— 手写一遍的实测成本是 **12 个既有文件、约 45 行插入**（其中 27 行是
 * 三份 nest `projects` 的重复块，占一半以上），且缩进与插入位置全靠手抄。
 *
 * ## 它改哪几个面（除 ⑧ 的 barrel **内容**外，每一面都有对应的 drift 用例 ——
 * barrel 没有唯一真源，不设守卫，理由写在那个 spec 的头注释里）
 *
 * | 面 | 文件 | 增量 |
 * |----|------|------|
 * | ① tsconfig paths | `apps/server/tsconfig.json` | +6 行（`@walnut-server/<x>` 与 `/*` 两个键） |
 * | ② nest filenames | `infra/nest/{dev,prod,stage}.json` | 各 +1 行 |
 * | ③ nest projects | 同上三份 | 各 +8 行（library 项目块） |
 * | ④ swc paths | `infra/swc/{dev,prod,stage}.swcrc` | 各 +2 行 |
 * | ⑤ app include | `apps/{api,cli,worker}/tsconfig.app.json` | 各 +1 行 |
 * | ⑥ eslint 分层名单 | `apps/server/eslint.config.ts` | +1 行（改一行数组） |
 * | ⑦ 分层矩阵 | drift spec 里的 `LAYER_MATRIX` | +1 行（改一行数组） |
 * | ⑧ 新文件 | `libs/<x>/tsconfig.lib.json`、`libs/<x>/src/index.ts` | 2 个新文件 |
 *
 * ⑦ 最容易被漏掉：drift spec 里那份矩阵是「按 ADR 0022 应该长什么样」的**独立表述**，只改 ⑥ 不改 ⑦
 * 会立刻红（`layer libs 并集 ≠ 矩阵`）。所以本工具把 ⑦ 也一起改 —— 它是注册面的一部分，
 * 只是恰好写在一个 `.spec.ts` 里。
 *
 * ## 幂等
 *
 * 每个变换都是「已经有了就原样返回」。**连跑两次的 git diff 必须为空** —— 这是验收判据，不是
 * 附加项：一个不能重复执行的脚手架，第二次就会把配置写坏。
 *
 * ## 哪几层拒绝自动登记（fail-closed，不猜）
 *
 * `identity` / `system` / `auth` / `security` 四个域层**拒绝**：它们的 `layer(...)` 接线用的是
 * `...DOMAIN_LIBS.filter(lib => lib !== 'identity')` 这种「单成员层」写法，往层里塞第二个 lib 会让
 * rank 推导出的 banned 集合与接线对不上（drift spec 会红，但红的位置离原因很远）。这几层要手工加，
 * 并在评审里说明为什么该域需要第二个 lib。
 *
 * 另外：本文件**刻意不用模板串**（一律 indexOf + 字符串拼接）。它的编辑对象是 JSON / TS 源码，
 * 锚点必须逐字符可控；字符串拼接也让"插入的到底是什么"在 diff 里看得见。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 一个待写的文件：`before === null` 表示新建 */
export interface ScaffoldFile {
  /** 相对仓库根 */
  path: string
  before: string | null
  after: string
}

/** 可自动登记的层。键就是 `--layer` 的取值 */
export const SCAFFOLD_LAYERS = {
  'infra': { list: 'INFRA_LIBS', literal: null },
  'tech-base': { list: 'TECH_BASE_LIBS', literal: null },
  'tech-assemble': { list: 'TECH_ASSEMBLE_LIBS', literal: null },
  'guards': { list: 'TOP_LIBS', literal: 'guards' },
  'app-domain': { list: 'TOP_LIBS', literal: 'app-domain' },
} as const

export type ScaffoldLayer = keyof typeof SCAFFOLD_LAYERS

/** 拒绝自动登记的四层（理由见文件头「哪几层拒绝自动登记」） */
export const REFUSED_LAYERS = ['identity', 'system', 'auth', 'security'] as const

export const LAYER_CHOICES = Object.keys(SCAFFOLD_LAYERS).join(' | ')

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export function assertLibName(name: string): void {
  if (!NAME_PATTERN.test(name))
    throw new Error(`lib 名 ${name} 不是小写 kebab-case（例：scope-resolver）。drift 守卫按 [\\w-]+ 解析别名，其它字符会被静默忽略`)
}

/** 从 openAt 处的 `[` / `{` 找到配对的闭合符号下标（跳过字符串字面量） */
function closeBracketAfter(text: string, openAt: number): number {
  const open = text[openAt]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let quote: string | null = null
  for (let i = openAt; i < text.length; i++) {
    const char = text[i]
    if (quote !== null) {
      if (char === '\\')
        i++
      else if (char === quote)
        quote = null
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      continue
    }
    if (char === open) {
      depth++
    }
    else if (char === close && --depth === 0) {
      return i
    }
  }
  throw new Error(`从下标 ${openAt} 起找不到配对的 ${close}`)
}

/** 某下标所在行的行首缩进 */
function indentAt(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  let end = lineStart
  while (text[end] === ' ' || text[end] === '\t')
    end++
  return text.slice(lineStart, end)
}

/** 找 needle 的第 n 次（从 0 起）出现；找不到返回 -1 */
function indexOfNth(text: string, needle: string, from: number): number {
  return text.indexOf(needle, from)
}

/** 找 needle 的**最后**一次出现（from 省略 = 全串）；找不到返回 -1 */
function lastIndexOfFrom(text: string, needle: string, from?: number): number {
  return from === undefined ? text.lastIndexOf(needle) : text.lastIndexOf(needle, from)
}

/**
 * 在 anchorEnd（某个值的最后一个字符之后）插入若干**完整条目文本**。
 *
 * 逗号由锚点现状决定：锚点后面已经有逗号 ⇒ 新条目不是最后一个 ⇒ 新条目补尾逗号；
 * 没有逗号 ⇒ 锚点是最后一个 ⇒ 给锚点补逗号、新条目不补。
 */
function insertJsonEntries(text: string, anchorEnd: number, entries: readonly string[], eol: string): string {
  const rest = text.slice(anchorEnd)
  let spaces = 0
  while (rest[spaces] === ' ' || rest[spaces] === '\t')
    spaces++
  const hasComma = rest[spaces] === ','
  const block = entries.join(`,${eol}`) + (hasComma ? ',' : '')
  if (hasComma) {
    const at = anchorEnd + spaces + 1
    return text.slice(0, at) + eol + block + text.slice(at)
  }
  return `${text.slice(0, anchorEnd)},${eol}${block}${text.slice(anchorEnd)}`
}

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** ① apps/server/tsconfig.json 的 compilerOptions.paths（两个键：根 + 子路径） */
export function insertTsconfigPaths(text: string, name: string, eol = '\n'): string {
  const alias = `"` + `@walnut-server/${name}"`
  if (text.includes(alias))
    return text

  const anchorKey = lastIndexOfFrom(text, '/*": [')
  if (anchorKey < 0)
    throw new Error('tsconfig.json 里找不到任何 @walnut-server/<lib>/* 别名锚点（找不到锚点就不能安全插入）')

  const keyAt = text.lastIndexOf('"@walnut-server/', anchorKey)
  const openAt = indexOfNth(text, '[', keyAt)
  const closeAt = closeBracketAfter(text, openAt)
  const indent = indentAt(text, keyAt)
  const inner = `${indent}  `

  return insertJsonEntries(text, closeAt + 1, [
    `${indent}"@walnut-server/${name}": [${eol}${inner}"./libs/${name}/src"${eol}${indent}]`,
    `${indent}"@walnut-server/${name}/*": [${eol}${inner}"./libs/${name}/src/*"${eol}${indent}]`,
  ], eol)
}

/** ④ infra/swc/*.swcrc 的 jsc.paths（单行条目，两个键） */
export function insertSwcPaths(text: string, name: string, eol = '\n'): string {
  const alias = `"` + `@walnut-server/${name}"`
  if (text.includes(alias))
    return text

  const anchorKey = lastIndexOfFrom(text, '/*": [')
  if (anchorKey < 0)
    throw new Error('swcrc 里找不到任何 @walnut-server/<lib>/* 别名锚点')

  const keyAt = text.lastIndexOf('"@walnut-server/', anchorKey)
  const openAt = indexOfNth(text, '[', keyAt)
  const closeAt = closeBracketAfter(text, openAt)
  const indent = indentAt(text, keyAt)

  return insertJsonEntries(text, closeAt + 1, [
    `${indent}"@walnut-server/${name}": ["libs/${name}/src"]`,
    `${indent}"@walnut-server/${name}/*": ["libs/${name}/src/*"]`,
  ], eol)
}

/** ② infra/nest/*.json 的 filenames（锚点只在 filenames 数组内 —— projects 里也有同形的 libs/<x>/src） */
export function insertNestFilenames(text: string, name: string, eol = '\n'): string {
  const entry = `"libs/${name}/src"`
  if (text.includes(`${entry},`) || text.includes(`${entry}\n`))
    return text

  const arrayAt = indexOfNth(text, '"filenames": [', 0)
  if (arrayAt < 0)
    throw new Error('nest json 里找不到 "filenames": [')
  const openAt = indexOfNth(text, '[', arrayAt)
  const closeAt = closeBracketAfter(text, openAt)

  const lastAt = lastIndexOfFrom(text, '"libs/', closeAt - 1)
  if (lastAt < 0 || lastAt < openAt)
    throw new Error('nest json 的 filenames 里没有任何 libs/<x>/src 条目（找不到锚点）')

  const valueEnd = indexOfNth(text, '"', lastAt + 1)
  const indent = indentAt(text, lastAt)
  return insertJsonEntries(text, valueEnd + 1, [indent + entry], eol)
}

/** ③ infra/nest/*.json 的 projects（8 行 library 块，插在最后一个 library 项目之后） */
export function insertNestProject(text: string, name: string, eol = '\n'): string {
  const tsConfigPath = `"libs/${name}/tsconfig.lib.json"`
  if (text.includes(tsConfigPath))
    return text

  const projectsAt = indexOfNth(text, '"projects": {', 0)
  if (projectsAt < 0)
    throw new Error('nest json 里找不到 "projects": {')

  const typeAt = lastIndexOfFrom(text, '"type": "library"')
  if (typeAt < projectsAt)
    throw new Error('nest json 的 projects 里找不到任何 "type": "library" 项目')

  // 从 type 行往回找包住它的 {（深度归零处），再往后找配对的 }
  let objectOpen = -1
  let depth = 0
  for (let i = typeAt; i >= projectsAt; i--) {
    const char = text[i]
    if (char === '}') {
      depth++
    }
    else if (char === '{') {
      if (depth === 0) {
        objectOpen = i
        break
      }
      depth--
    }
  }
  if (objectOpen < 0)
    throw new Error('找不到 library 项目对象的起始花括号')

  const objectClose = closeBracketAfter(text, objectOpen)
  const indent = indentAt(text, objectOpen)
  const inner = `${indent}  `
  const deeper = `${inner}  `

  const block = [
    `${indent}"${name}": {`,
    `${inner}"type": "library",`,
    `${inner}"root": "libs/${name}",`,
    `${inner}"entryFile": "index",`,
    `${inner}"sourceRoot": "libs/${name}/src",`,
    `${inner}"compilerOptions": {`,
    `${deeper}"tsConfigPath": "libs/${name}/tsconfig.lib.json"`,
    `${inner}}`,
    `${indent}}`,
  ].join(eol)

  return insertJsonEntries(text, objectClose + 1, [block], eol)
}

/** ⑤ apps/{api,cli,worker}/tsconfig.app.json 的 include */
export function insertAppInclude(text: string, name: string, eol = '\n'): string {
  const entry = `"../../libs/${name}/src/**/*"`
  if (text.includes(entry))
    return text

  const includeAt = indexOfNth(text, '"include": [', 0)
  if (includeAt < 0)
    throw new Error('tsconfig.app.json 里找不到 "include": [')
  const openAt = indexOfNth(text, '[', includeAt)
  const closeAt = closeBracketAfter(text, openAt)

  const lastAt = lastIndexOfFrom(text, '"../../libs/', closeAt - 1)
  if (lastAt < 0)
    throw new Error('tsconfig.app.json 的 include 里没有任何 ../../libs/<x>/src/**/* 条目')

  const suffixAt = indexOfNth(text, '/**/*"', lastAt)
  const valueEnd = suffixAt + '/**/*'.length
  const indent = indentAt(text, lastAt)
  return insertJsonEntries(text, valueEnd + 1, [indent + entry], eol)
}

/** ⑥ eslint.config.ts 的分层名单（单行字面量数组 —— drift 守卫按单行正则读，别改成跨行） */
export function insertLayerList(text: string, listName: string, name: string): string {
  const head = `const ${listName} = [`
  const at = indexOfNth(text, head, 0)
  if (at < 0)
    throw new Error(`eslint.config.ts 里找不到 ${listName} 的单行字面量数组`)
  const bodyStart = at + head.length
  const bodyEnd = indexOfNth(text, ']', bodyStart)
  if (bodyEnd < 0)
    throw new Error(`${listName} 的数组没有闭合方括号`)
  const body = text.slice(bodyStart, bodyEnd)
  if (body.includes(`'${name}'`))
    return text
  const separator = body.trimEnd() === '' ? '' : ', '
  return `${text.slice(0, bodyStart) + body + separator}'${name}'${text.slice(bodyEnd)}`
}

/** ⑥b 单成员层的 layer('x', ['x'], ...) 接线（只有 guards / app-domain 走这条） */
export function insertLayerLiteral(text: string, layer: string, name: string): string {
  const head = `layer('${layer}', [`
  const at = indexOfNth(text, head, 0)
  if (at < 0)
    throw new Error(`eslint.config.ts 里找不到 ${head}]) 的调用`)
  const bodyStart = at + head.length
  const bodyEnd = indexOfNth(text, ']', bodyStart)
  const body = text.slice(bodyStart, bodyEnd)
  if (body.includes(`'${name}'`))
    return text
  return `${text.slice(0, bodyStart) + body}, ` + `'${name}'${text.slice(bodyEnd)}`
}

/** ⑦ drift spec 的 LAYER_MATRIX 行（按 ADR 0022 应该长什么样的独立表述） */
export function insertMatrixRow(text: string, layer: string, name: string): string {
  const head = `{ name: '${layer}', libs: [`
  const at = indexOfNth(text, head, 0)
  if (at < 0)
    throw new Error(`drift spec 的 LAYER_MATRIX 里找不到层 ${layer}`)
  const bodyStart = at + head.length
  const bodyEnd = indexOfNth(text, '] }', bodyStart)
  if (bodyEnd < 0)
    throw new Error(`LAYER_MATRIX 里层 ${layer} 的 libs 数组没有以 ] } 收尾`)
  const body = text.slice(bodyStart, bodyEnd)
  if (body.includes(`'${name}'`))
    return text
  return `${text.slice(0, bodyStart) + body}, ` + `'${name}'${text.slice(bodyEnd)}`
}

/** ⑧ 新 lib 的 tsconfig.lib.json（形状与既有 34 个 lib 逐字一致） */
export function renderTsconfigLib(name: string): string {
  return [
    '{',
    '  "extends": "../../tsconfig.lib.base.json",',
    '  "compilerOptions": {',
    `    "outDir": "../../dist/libs/${name}"`,
    '  }',
    '}',
    '',
  ].join('\n')
}

/** ⑧ 新 lib 的 src/index.ts（barrel；drift 守卫以它作为「lib 存在」的判据） */
export function renderBarrel(name: string): string {
  return [
    '/**',
    ` * ${name} —— 新建 lib 的 barrel（由 pnpm scaffold:lib 生成）。`,
    ' *',
    ' * 这里只做聚合：真实现放同级目录，具名导出后从本文件转出。',
    ' * 增删注册面之后跑一遍 drift 守卫（下面这个 spec 就是它）：',
    ' *   apps/server/apps/api/src/common/monorepo/__tests__/lib-registration.drift.spec.ts',
    ' */',
    'export {}',
    '',
  ].join('\n')
}

const NEST_CONFIGS = [
  'apps/server/infra/nest/dev.json',
  'apps/server/infra/nest/prod.json',
  'apps/server/infra/nest/stage.json',
] as const

const SWCRC_CONFIGS = [
  'apps/server/infra/swc/dev.swcrc',
  'apps/server/infra/swc/prod.swcrc',
  'apps/server/infra/swc/stage.swcrc',
] as const

const APP_TSCONFIGS = [
  'apps/server/apps/api/tsconfig.app.json',
  'apps/server/apps/cli/tsconfig.app.json',
  'apps/server/apps/worker/tsconfig.app.json',
] as const

export const SERVER_TSCONFIG = 'apps/server/tsconfig.json'
export const SERVER_ESLINT = 'apps/server/eslint.config.ts'
export const DRIFT_SPEC = 'apps/server/apps/api/src/common/monorepo/__tests__/lib-registration.drift.spec.ts'

/** 把全部注册面算成一份「待写清单」（纯函数：不写盘，便于单测与预览） */
export function planScaffold(root: string, name: string, layer: ScaffoldLayer): ScaffoldFile[] {
  assertLibName(name)

  const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8')
  const map = (relative: string, transform: (before: string) => string): ScaffoldFile => {
    const before = read(relative)
    return { path: relative, before, after: transform(before) }
  }

  const spec = SCAFFOLD_LAYERS[layer]
  const files: ScaffoldFile[] = [
    map(SERVER_TSCONFIG, text => insertTsconfigPaths(text, name, detectEol(text))),
    ...NEST_CONFIGS.map(relative => map(relative, text => insertNestProject(insertNestFilenames(text, name, detectEol(text)), name, detectEol(text)))),
    ...SWCRC_CONFIGS.map(relative => map(relative, text => insertSwcPaths(text, name, detectEol(text)))),
    ...APP_TSCONFIGS.map(relative => map(relative, text => insertAppInclude(text, name, detectEol(text)))),
    map(SERVER_ESLINT, (text) => {
      const withList = insertLayerList(text, spec.list, name)
      return spec.literal === null ? withList : insertLayerLiteral(withList, spec.literal, name)
    }),
    map(DRIFT_SPEC, text => insertMatrixRow(text, layer, name)),
  ]

  const tsconfigLib = `apps/server/libs/${name}/tsconfig.lib.json`
  const barrel = `apps/server/libs/${name}/src/index.ts`
  files.push({
    path: tsconfigLib,
    before: existsSync(path.join(root, tsconfigLib)) ? read(tsconfigLib) : null,
    after: renderTsconfigLib(name),
  })
  files.push({
    path: barrel,
    before: existsSync(path.join(root, barrel)) ? read(barrel) : null,
    after: renderBarrel(name),
  })

  return files
}

/** 把待写清单落盘，返回真正发生变化的文件（幂等：第二次调用返回空数组） */
export function applyScaffold(root: string, files: readonly ScaffoldFile[]): ScaffoldFile[] {
  const changed = files.filter(file => file.before !== file.after)
  for (const file of changed) {
    const absolute = path.join(root, file.path)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, file.after, 'utf8')
  }
  return changed
}

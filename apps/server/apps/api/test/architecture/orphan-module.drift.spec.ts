import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * A4：孤儿 `@Module` 守卫 —— 每个模块类都必须进得了某条 `imports: [...]`。
 *
 * 背景：Nest 的模块只有被上层模块 import 才会进应用图。模块类写完、service/controller 也有人
 * import，但**没人把它装进 `imports`** 时，`tsc` / lint / 单测全绿 —— 它的 provider 永远不会被
 * 实例化，只在运行期表现成「某个东西不工作」。历史上真出现过一次真孤儿（已修），本文件是它的
 * 机械防线。
 *
 * ## 判据（一句话）
 *
 * 「被引用」≝ 该类名出现在**某个 `@Module({ imports: [...] })` 的数组字面量**里。
 *
 * 为什么必须 array-aware、不能全文 grep 类名 —— 类名在源码里到处都是，grep 会把下面这些全部
 * 当成「被引用」，于是孤儿永远查不出来（假绿）：
 *   - `import { FooModule } from './foo.module'`（import 语句本身不构成装配）
 *   - `// 见 FooModule`、`'FooModule'`（注释与字符串）
 *   - `providers: [FooModule]` / `exports: [FooModule]`（不是 imports）
 *   - `Type<FooModule>`、构造器参数类型标注（类型位）
 * 所以这里解析语法树，只从 `imports` 属性的初始化式里取标识符，并且只在**数组字面量**里取；
 * `...spread`、`cond ? [] : [X]`（本仓 AppModule 的 bootstrap 任务就是这种写法）、
 * `...本文件里的数组常量`都会展开。"自测"两条用例把这条语义固定住。
 *
 * ## 扫描面
 *
 * 声明侧 = `apps/api/src` 与 `libs`（要求「必须被装配」的模块都住在这里）。
 * 引用侧 = 上面两处 + `apps/cli/src` + `apps/worker/src` —— 两个组合入口自己装配模块
 * （`worker.module.ts` 的 imports 里有 `AppCoreModule`），但它们**不参与声明侧**：那两个文件里
 * 的模块类本身就是组合根，要求它被别人 import 是自指。
 * 测试文件（`*.spec.ts`）两侧都排除：测试里的 `Test.createTestingModule({ imports: [...] })`
 * 不是生产装配。
 *
 * ## 允许清单（写理由，不许为了变绿扩大）
 *
 * 只有两类能进：**组合根**（Nest 的 root module 按定义不由 imports 装配，而是
 * `NestFactory.create` 的入参）、**只在测试里装配的模块**（生产图里没有它的位置，但它是被测
 * 对象）。目前第二类为空。清单自带反查：登记的类若已不存在、或已经被 imports 引用，本文件报红
 * —— 它不会变成一张只增不减的豁免表。
 *
 * ## 负对照
 *
 * 临时在 `apps/api/src` 下造一个不被任何 imports 引用的 `@Module` 类 ⇒ 本文件红；删掉 ⇒ 绿。
 *
 * 手段：只读源码 + TypeScript 解析器（零装载、零副作用，与同目录其它 drift spec 同款）。
 */

const SERVER_ROOT = process.cwd()

/** 声明侧：`@Module` 类的「家」 */
const DECLARATION_ROOTS = ['apps/api/src', 'libs'] as const

/** 引用侧：多出两个组合入口的源码（组合根在那里装配 AppCoreModule / bootstrap 任务） */
const REFERENCE_ROOTS = ['apps/api/src', 'libs', 'apps/cli/src', 'apps/worker/src'] as const

/**
 * 目录名级跳过。注意**不许**写裸名 `logs` —— 它会把 `libs/system/src/logs/**`（真实源码树）
 * 整棵剪掉；运行期日志目录按绝对路径跳（与 repo-global.drift.spec.ts 同款口径）。
 */
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'dist-stage',
  'coverage',
  'env-local',
  'env-encrypted',
  'public',
])

const SKIP_ABSOLUTE_PATHS = new Set([join(SERVER_ROOT, 'logs')])

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIR_NAMES.has(entry.name) && !SKIP_ABSOLUTE_PATHS.has(full)) {
        walkTsFiles(full, out)
      }
      continue
    }
    if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts') && !full.endsWith('.spec.ts')) {
      out.push(full)
    }
  }
  return out
}

const rel = (file: string): string => relative(SERVER_ROOT, file).split(sep).join('/')

// ─── 源码解析（语法树，零装载）───────────────────────────────────────────────────

/**
 * 类节点上的装饰器：`ts.getDecorators` 在「没有装饰器」时返回 `undefined`（不是空数组），
 * 所以可选调用 + 空数组兜底。真取不到装饰器时，本文件的「扫描口径有效」用例会因子类数为 0
 * 而报红 —— 失效是响的，不是静的（与 repo-global.drift.spec.ts 同款写法）。
 */
function decoratorsOf(node: ts.ClassDeclaration): readonly ts.Decorator[] {
  return ts.getDecorators?.(node) ?? []
}

/** `@Module(...)` 的调用表达式；不是 `@Module` 类返回 null。别名装饰器（`Module as M`）不认，本仓不用 */
function moduleDecoratorCall(node: ts.ClassDeclaration): ts.CallExpression | null {
  for (const decorator of decoratorsOf(node)) {
    const expression = decorator.expression
    if (ts.isCallExpression(expression) && expression.expression.getText() === 'Module') {
      return expression
    }
  }
  return null
}

/** `@Module({...})` 的对象字面量实参（`@Module()` 这类无参形态返回 null，但仍是模块类） */
function moduleOptions(node: ts.ClassDeclaration): ts.ObjectLiteralExpression | null {
  const call = moduleDecoratorCall(node)
  if (call === null) {
    return null
  }
  const [argument] = call.arguments
  return argument !== undefined && ts.isObjectLiteralExpression(argument) ? argument : null
}

/**
 * 从 `imports:` 的初始化式里收集模块类标识符（**array-aware**：只认数组字面量的元素）。
 *
 * 会展开的形态：数组字面量 / `...spread` / 条件表达式（`cond ? [] : [X]`）/
 * 括号与 `as` 断言 / 逻辑表达式 / 本文件内的数组常量。**不会**下钻的：对象字面量与函数调用
 * （`SomeModule.forRoot({ ... })` 的参数里出现类名不构成装配），也绝不碰类型位。
 */
function collectImportedIdentifiers(
  options: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  localArrays: Map<string, ts.Expression>,
  out: Set<string>,
): void {
  const seen = new Set<ts.Node>()

  const visit = (expression: ts.Expression): void => {
    if (seen.has(expression)) {
      return
    }
    seen.add(expression)

    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        visit(element)
      }
      return
    }
    if (ts.isSpreadElement(expression)) {
      visit(expression.expression)
      return
    }
    if (ts.isIdentifier(expression)) {
      const local = localArrays.get(expression.text)
      if (local === undefined) {
        out.add(expression.text)
        return
      }
      visit(local)
      return
    }
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
      visit(expression.expression)
      return
    }
    if (ts.isConditionalExpression(expression)) {
      visit(expression.whenTrue)
      visit(expression.whenFalse)
      return
    }
    if (ts.isBinaryExpression(expression)) {
      visit(expression.left)
      visit(expression.right)
    }
  }

  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || property.name.getText(sourceFile) !== 'imports') {
      continue
    }
    visit(property.initializer)
  }
}

/** 文件顶层 `const X = [...]` 的数组常量（`imports: [...X]` 只有展开后才看得见它带了谁） */
function readLocalArrays(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const arrays = new Map<string, ts.Expression>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined && ts.isArrayLiteralExpression(declaration.initializer)) {
        arrays.set(declaration.name.text, declaration.initializer)
      }
    }
  }
  return arrays
}

/** 一段源码里所有 `@Module({ imports: [...] })` 引用的标识符 */
function readImportedIdentifiers(fileName: string, text: string): Set<string> {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, true)
  const localArrays = readLocalArrays(sourceFile)
  const identifiers = new Set<string>()

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) {
      continue
    }
    const options = moduleOptions(statement)
    if (options !== null) {
      collectImportedIdentifiers(options, sourceFile, localArrays, identifiers)
    }
  }
  return identifiers
}

/** 一段源码里 `@Module` 装饰的类名（`@Module()` 无参形态也算模块类） */
function readModuleClassNames(fileName: string, text: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, true)
  const names: string[] = []
  for (const statement of sourceFile.statements) {
    if (ts.isClassDeclaration(statement) && statement.name !== undefined && moduleDecoratorCall(statement) !== null) {
      names.push(statement.name.text)
    }
  }
  return names
}

/** 一段源码里有没有任意 `@Module` 类（决定它是不是需要扫描的模块文件） */
function declaresModuleClass(fileName: string, text: string): boolean {
  return readModuleClassNames(fileName, text).length > 0
}

// ─── 扫描面 ──────────────────────────────────────────────────────────────────────

interface IModuleClass {
  className: string
  /** 相对 `apps/server/` 的 posix 路径 */
  file: string
}

interface IScan {
  declarationFiles: string[]
  referenceFiles: string[]
  moduleClasses: IModuleClass[]
  referenced: Set<string>
}

function scan(): IScan {
  const declarationFiles = DECLARATION_ROOTS.flatMap(root => walkTsFiles(join(SERVER_ROOT, root)))
  const referenceFiles = REFERENCE_ROOTS.flatMap(root => walkTsFiles(join(SERVER_ROOT, root)))

  const moduleClasses: IModuleClass[] = []
  for (const file of declarationFiles) {
    const text = readFileSync(file, 'utf8')
    if (!declaresModuleClass(file, text)) {
      continue
    }
    for (const className of readModuleClassNames(file, text)) {
      moduleClasses.push({ className, file: rel(file) })
    }
  }

  const referenced = new Set<string>()
  for (const file of referenceFiles) {
    const text = readFileSync(file, 'utf8')
    for (const identifier of readImportedIdentifiers(file, text)) {
      referenced.add(identifier)
    }
  }

  return { declarationFiles, referenceFiles, moduleClasses, referenced }
}

const scanResult = scan()

// ─── 允许清单 ────────────────────────────────────────────────────────────────────

/**
 * 允许清单：**只允许组合根**（root module 按 Nest 的定义不进任何 imports 数组，它是
 * `NestFactory.create` 的入参）与**只在测试里装配的模块**（后者目前为空）。
 * 新增一条 = 在评审里论证它为什么不属于任何上层模块；理由写在这里，不写在 commit message 里。
 */
const ALLOWED_UNREFERENCED: readonly { className: string, file: string, reason: string }[] = [
  {
    className: 'AppModule',
    file: 'apps/api/src/app/app.module.ts',
    reason: 'api 的组合根：由 apps/api/src/main.ts 与 apps/cli/src/export-openapi.ts 的 NestFactory.create(AppModule) 装配，按 Nest 的定义不、也不能进任何 imports 数组 —— 它没有上层模块。',
  },
]

const identityOf = (entry: { className: string, file: string }): string => `${entry.file}#${entry.className}`

// ─── 用例 ────────────────────────────────────────────────────────────────────────

describe('a4 孤儿 @Module 守卫（imports 数组命中，array-aware）', () => {
  it('扫描口径有效（扫不到文件 / 一个模块类都没解析到时，本守卫必须失效报警而不是全绿）', () => {
    expect(scanResult.declarationFiles.length).toBeGreaterThanOrEqual(100)
    expect(scanResult.referenceFiles.length).toBeGreaterThanOrEqual(scanResult.declarationFiles.length)
    expect(scanResult.moduleClasses.length).toBeGreaterThanOrEqual(100)
    // 引用侧确实解析出了东西：绝大多数模块都能被某个 imports 数组命中
    const hit = scanResult.moduleClasses.filter(entry => scanResult.referenced.has(entry.className))
    expect(hit.length).toBeGreaterThanOrEqual(100)
    // 引用侧比声明侧多出的两个入口必须真的进过扫描（worker.module.ts 是 AppCoreModule 的唯一装配点）
    expect(scanResult.referenceFiles.map(rel)).toContain('apps/worker/src/worker.module.ts')
  })

  it('自测：注释 / 字符串 / import 语句 / providers / 类型位里的类名都不算被引用', () => {
    const source = [
      'import { FooModule } from \'./foo.module\'',
      '// imports: [FooModule] —— 注释里的不算',
      'const label = \'FooModule\'',
      'class HolderService {',
      '  constructor(private readonly foo: FooModule) {}',
      '}',
      '@Module({',
      '  imports: [],',
      '  exports: [FooModule],',
      '  providers: [FooModule],',
      '})',
      'export class BarModule {}',
    ].join('\n')

    expect(readImportedIdentifiers('probe.ts', source).size).toBe(0)
    // 反向确认它不是「什么都解析不出来」：同一个类名放进 imports 数组就必须命中
    expect(readImportedIdentifiers('probe.ts', source.replace('imports: []', 'imports: [FooModule]')).has('FooModule')).toBe(true)
  })

  it('自测：条件表达式与展开里的数组仍要认（AppModule 的 bootstrap 任务就是这种写法）', () => {
    const source = [
      'const sharedModules = [FolderModule]',
      '@Module({',
      '  imports: [...(cond ? [] : [BazModule]), QuxModule, ...sharedModules],',
      '})',
      'export class ProbeModule {}',
    ].join('\n')

    const found = readImportedIdentifiers('probe.ts', source)
    expect(found.has('BazModule')).toBe(true)
    expect(found.has('QuxModule')).toBe(true)
    expect(found.has('FolderModule')).toBe(true)
  })

  it('模块类名在扫描面内唯一（名字匹配的前提：重名会让孤儿判定假绿）', () => {
    const filesByClass = new Map<string, string[]>()
    for (const { className, file } of scanResult.moduleClasses) {
      filesByClass.set(className, [...(filesByClass.get(className) ?? []), file])
    }
    const duplicated = [...filesByClass]
      .filter(([, files]) => files.length > 1)
      .map(([className, files]) => `${className}（${files.join(', ')}）`)
    expect(duplicated, '同名 @Module 类出现在多个文件 —— 请改名（本守卫按类名对账）').toEqual([])
  })

  it('每个 @Module 类都必须被某个 imports 数组引用（除允许清单）', () => {
    const allowed = new Set(ALLOWED_UNREFERENCED.map(identityOf))
    const orphans = scanResult.moduleClasses
      .filter(entry => !scanResult.referenced.has(entry.className))
      .filter(entry => !allowed.has(identityOf(entry)))
      .map(entry => `${entry.file} 的 ${entry.className}`)

    expect(orphans, '这些 @Module 类没有任何模块 imports 它（孤儿：provider 永远不会被实例化）').toEqual([])
  })

  it('允许清单反查：登记的类必须仍然存在、仍然零引用（不需要了就得删掉，清单不许腐烂）', () => {
    const declared = new Map(scanResult.moduleClasses.map(entry => [identityOf(entry), entry]))
    const problems: string[] = []

    for (const entry of ALLOWED_UNREFERENCED) {
      const identity = identityOf(entry)
      const found = declared.get(identity)
      if (found === undefined) {
        problems.push(`${identity} 已不存在（文件或类名改过？允许清单要跟着改）`)
        continue
      }
      if (scanResult.referenced.has(found.className)) {
        problems.push(`${identity} 现在已经被 imports 引用了 —— 从允许清单里删掉这条`)
      }
      if (entry.reason.trim() === '') {
        problems.push(`${identity} 没写理由（允许清单只收有理由的条目）`)
      }
    }

    expect(problems).toEqual([])
  })

  it('允许清单只收组合根 / 测试专用：条目数被钉住，加一条就必须改这里（防悄悄扩大）', () => {
    expect(ALLOWED_UNREFERENCED.map(identityOf)).toEqual(['apps/api/src/app/app.module.ts#AppModule'])
  })
})

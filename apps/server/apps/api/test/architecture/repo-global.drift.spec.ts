import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * D10：Repository / Shared Service 的 `@Global` 判据 —— 机械版。
 *
 * 「三种 Repository 模式」收敛成两种形态（Repository + Shared Service）后，前两种的差别
 * 只剩「文件落哪」与「要不要 @Global」。@Global 的唯一判据是**消费方模块数 ≥ 2**
 * （口径见 apps/server/AGENTS.md 的「Repository 与 Shared Service」）：
 *
 * - 判据 ①（禁止滥用）：类 provider 的 `*.repo.module.ts` / `*.shared.module.ts`，消费方模块
 *   ≤ 1 时**不许** @Global —— @Global 唯一的作用是「省掉 N 个模块的 import」；只有一个消费方时
 *   它只做一件事：把真实依赖从 imports 图上抹掉。
 * - 判据 ①b（登记理由）：消费方模块 ≥ 2 的 @Global 模块，必须在模块注释里写下 @Global 的
 *   理由（AGENTS.md：≥ 2 才允许，并登记理由）。它是**文字门禁**：拦的是「@Global 悄悄留着、
 *   没人知道为什么」，理由本身对不对仍要人看。
 * - 判据 ②（防假绿）：非 @Global 模块，每个**实际注入了**它 provider 的模块都必须能通过
 *   imports 看见它（直连，或经上层的 `exports: [SomeModule]` 转出口 —— SysDeptModule /
 *   AuthSharedModule 就是后者）。否则这条注入靠的是别的路径（模块被别处间接引入、或又被偷偷
 *   改回 @Global），**只有 Nest 启动期才会炸**，类型检查与单测都看不见。
 *
 * 例外（ADR 0022 Decision 3 / D12）：模块同时**绑定 `WALNUT_ADMIN_*` 端口**
 * （providers 里有 `{ provide: TOKEN, ... }`）时，@Global 是端口可见性要求的，不适用判据 ①。
 *
 * 批 12（A1/A2/A3/A5）—— 本文件过去的四个盲区，全部已补：
 *
 * - **A1**：扫描面过去只认 `*.repo.module.ts`，`*.shared.module.ts` 结构性逃逸
 *   （`SysLogAuthSharedModule` 的 @Global 违规就是这么逃掉的）。
 * - **A2**：消费方计数过去只从 `providers[]` 建「类 → 宿主模块」映射、且只认构造器注入 ——
 *   `controllers[]` 里的宿主被算成 0，mixin 里的**属性级** `@Inject` 完全看不见；
 *   `{ provide: APP_GUARD, useClass: X }` 这种增强器登记形态同样没被算进来（现在就都算了）。
 * - **A3**：判据 ② 随 A1 一起覆盖 shared 形态；同时修好「按 provider 逐个判可见性」——
 *   过去是把模块**所有** provider 拿去比对，多 provider 模块（如
 *   `[SysLogAuthSharedService, Reflector]`）会拿没被注入的 `Reflector` 假红。
 * - **A5**：`SKIP_DIRS` 里的裸名 `'logs'` 把 `libs/system/src/logs/**` 整棵源码子树剪掉了
 *   （`apps/server/logs/` 是运行期日志目录，本意只跳它）。
 *
 * 手段：只读源码 + TypeScript 解析器（不 import 应用代码、不需要 DB / Redis）。
 */

const SERVER_ROOT = process.cwd()

/**
 * 目录名级跳过：这些名字在任何层级都不含源码（构建产物 / git / 依赖 / 本地 env）。
 *
 * A5：这里**不许**写裸名 `'logs'` —— 它会把 `libs/system/src/logs/**`（真实源码树）
 * 一起剪掉，`SysLogAuthSharedModule` 就永远不在本守卫视野里。运行期日志目录按绝对路径跳过。
 */
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  'env-local',
  'env-encrypted',
  'public',
])

/** 只跳 `apps/server/logs`（运行期日志，不是源码）；libs 里的 logs 源码目录必须留在扫描面内。 */
const SKIP_ABSOLUTE_PATHS = new Set([join(SERVER_ROOT, 'logs')])

/** 判据覆盖的模块后缀 —— Repository 与 Shared Service 两种形态（A1） */
const SCOPED_MODULE_FILE_RE = /\.(?:repo|shared)\.module\.ts$/

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
    if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

interface FileInfo {
  /** 文件里顶层声明的类名 */
  classes: string[]
  /** 嵌套声明的类名（mixin 工厂里返回的类）—— 只用于「本文件注入过 X」的诊断 */
  nestedClasses: string[]
  /** 类名 → 它注入的标识符（构造器参数类型 / 构造器 @Inject / 属性级 @Inject） */
  injections: Map<string, Set<string>>
  /** 本文件任何类注入过的标识符（含嵌套类），诊断用 */
  fileInjections: Set<string>
  /** `@Module({ providers: [...] })` 里的类 provider */
  providerClasses: string[]
  /** `@Module({ controllers: [...] })` 里的 controller（A2：它们的宿主模块也是消费方） */
  controllerClasses: string[]
  /** `@Module({ imports: [...] })` 里的标识符（含 `...someArray` 展开） */
  importedIds: string[]
  /** `@Module({ exports: [...] })` 里的标识符（含 `...someArray` 展开） */
  exportedIds: string[]
  /** providers 里是否存在 token 绑定（`{ provide: X, ... }`） */
  hasTokenBinding: boolean
  /** @Module 类上是否真的有 `@Global()` 装饰器（不是注释里提到） */
  isGlobal: boolean
  /** 文件里的全部注释文本（判据 ①b 用） */
  commentText: string
}

/**
 * 本地数组常量（`const sharedModules = [A, B, C]`）—— `imports` / `exports` 里的
 * `...sharedModules` 只有展开后才看得见它带了哪些模块（AuthSharedModule 就是这种写法，
 * 不展开会把「经它转出口的模块」误判成不可见 ⇒ 判据 ② 假红）。
 */
function readLocalArrayConsts(sf: ts.SourceFile): Map<string, string[]> {
  const arrays = new Map<string, string[]>()
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue
      }
      if (!ts.isArrayLiteralExpression(declaration.initializer)) {
        continue
      }
      const ids: string[] = []
      for (const element of declaration.initializer.elements) {
        if (ts.isIdentifier(element)) {
          ids.push(element.text)
        }
      }
      arrays.set(declaration.name.text, ids)
    }
  }
  return arrays
}

/** 读 `@Module({ <name>: [...] })` 的标识符；`...localArray` 展开（只认本文件内的数组常量） */
function readArrayProperty(
  arg: ts.ObjectLiteralExpression,
  sf: ts.SourceFile,
  name: string,
  localArrays: Map<string, string[]>,
): string[] {
  const ids: string[] = []
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop) || prop.name.getText(sf) !== name) {
      continue
    }
    if (!ts.isArrayLiteralExpression(prop.initializer)) {
      continue
    }
    for (const element of prop.initializer.elements) {
      if (ts.isIdentifier(element)) {
        ids.push(element.text)
      }
      else if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
        ids.push(...(localArrays.get(element.expression.text) ?? []))
      }
      // 增强器登记形态 { provide: APP_GUARD, useClass: X }：X 的依赖由**本模块**的注入器解析，
      // 所以它同样让本模块成为 X 依赖的消费方（A2 的第三种宿主形态，漏了同样假绿）
      else if (ts.isObjectLiteralExpression(element)) {
        for (const inner of element.properties) {
          if (ts.isPropertyAssignment(inner) && inner.name.getText(sf) === 'useClass' && ts.isIdentifier(inner.initializer)) {
            ids.push(inner.initializer.text)
          }
        }
      }
    }
  }
  return ids
}

const INJECT_DECORATOR_RE = /@Inject\(\s*([\w.]+)\s*\)/

function scan(file: string): FileInfo {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
  const info: FileInfo = {
    classes: [],
    nestedClasses: [],
    injections: new Map(),
    fileInjections: new Set(),
    providerClasses: [],
    controllerClasses: [],
    importedIds: [],
    exportedIds: [],
    hasTokenBinding: false,
    isGlobal: false,
    commentText: '',
  }
  const localArrays = readLocalArrayConsts(sf)

  const noteInjection = (className: string, injected: string): void => {
    const bucket = info.injections.get(className) ?? new Set<string>()
    bucket.add(injected)
    info.injections.set(className, bucket)
    info.fileInjections.add(injected)
  }
  const readInjectDecorators = (className: string, decorators: readonly ts.Decorator[] | undefined): void => {
    for (const decorator of decorators ?? []) {
      const token = decorator.getText(sf).match(INJECT_DECORATOR_RE)
      if (token) {
        noteInjection(className, token[1])
      }
    }
  }

  for (const node of sf.statements) {
    if (!ts.isClassDeclaration(node) || !node.name) {
      continue
    }
    info.classes.push(node.name.text)

    for (const member of node.members) {
      if (ts.isConstructorDeclaration(member)) {
        for (const param of member.parameters) {
          if (param.type && ts.isTypeReferenceNode(param.type)) {
            noteInjection(node.name.text, param.type.typeName.getText(sf))
          }
          readInjectDecorators(node.name.text, ts.getDecorators?.(param))
        }
        continue
      }
      // A2：属性级 / 方法级 @Inject（mixin guard 的写法：@Inject(SomeService) private readonly x）
      if (ts.isPropertyDeclaration(member) || ts.isMethodDeclaration(member)) {
        readInjectDecorators(node.name.text, ts.getDecorators?.(member))
      }
    }

    const decorators = ts.getDecorators?.(node) ?? []
    const moduleDecorator = decorators
      .find(decorator => decorator.expression.getText(sf).startsWith('Module'))
    // 只认真正的装饰器（注释里提到 @Global 不算）：@Global() 的 expression 是 CallExpression
    info.isGlobal = decorators.some(decorator => /^Global\s*\(\s*\)$/.test(decorator.expression.getText(sf)))
    const arg = moduleDecorator && ts.isCallExpression(moduleDecorator.expression)
      ? moduleDecorator.expression.arguments[0]
      : undefined
    if (!arg || !ts.isObjectLiteralExpression(arg)) {
      continue
    }

    info.providerClasses = readArrayProperty(arg, sf, 'providers', localArrays)
    info.controllerClasses = readArrayProperty(arg, sf, 'controllers', localArrays)
    info.importedIds = readArrayProperty(arg, sf, 'imports', localArrays)
    info.exportedIds = readArrayProperty(arg, sf, 'exports', localArrays)
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop) || prop.name.getText(sf) !== 'providers') {
        continue
      }
      if (!ts.isArrayLiteralExpression(prop.initializer)) {
        continue
      }
      if (prop.initializer.elements.some(element => !ts.isIdentifier(element))) {
        info.hasTokenBinding = true
      }
    }
  }

  // 嵌套类（mixin 工厂 `export function X() { class Y {} }`）：只登记注入关系，不做模块归属
  const visit = (node: ts.Node): void => {
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) {
      info.nestedClasses.push(node.name.text)
      for (const member of node.members) {
        if (ts.isPropertyDeclaration(member) || ts.isMethodDeclaration(member)) {
          readInjectDecorators(node.name.text, ts.getDecorators?.(member))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  const commentRanges: [number, number][] = []
  const collectComments = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
      commentRanges.push([range.pos, range.end])
    }
    ts.forEachChild(node, collectComments)
  }
  collectComments(sf)
  info.commentText = commentRanges.map(([pos, end]) => text.slice(pos, end)).join('\n')

  return info
}

const allFiles = walkTsFiles(SERVER_ROOT)
const isTestFile = (file: string) => /[\\/](?:test|__tests__)[\\/]/.test(file) || file.endsWith('.spec.ts')
const infos = new Map(allFiles.filter(file => !isTestFile(file)).map(file => [file, scan(file)]))

/** 类名 → 它注入的标识符（跨文件合并；嵌套类也进） */
const injectionsByClass = new Map<string, Set<string>>()
/** 本仓自己声明的类名 —— 用来把 `Reflector` 这类框架内置 provider 排除出「本模块的 provider」 */
const repoDeclaredClasses = new Set<string>()
for (const [, info] of infos) {
  for (const [className, injected] of info.injections) {
    const bucket = injectionsByClass.get(className) ?? new Set<string>()
    for (const name of injected) {
      bucket.add(name)
    }
    injectionsByClass.set(className, bucket)
  }
  for (const className of info.classes) {
    repoDeclaredClasses.add(className)
  }
  for (const className of info.nestedClasses) {
    repoDeclaredClasses.add(className)
  }
}

/** 模块类名 → 文件 */
const moduleByClass = new Map<string, string>()
for (const [file, info] of infos) {
  if (!file.endsWith('.module.ts')) {
    continue
  }
  const moduleClass = info.classes.find(name => name.endsWith('Module'))
  if (moduleClass !== undefined) {
    moduleByClass.set(moduleClass, file)
  }
}

/**
 * 模块对外可见的类 provider 集合：自己 `exports` 的 provider，加上它 re-export 的子模块
 * （`exports: [SomeModule]`，含 `...someArray` 展开）递归带出的那些。
 * Nest 的可见性按模块算，所以判据 ② 必须按这个闭包判，不能只看「有没有直接 import」。
 */
const exportedProvidersCache = new Map<string, Set<string>>()
function exportedClassProviders(moduleFile: string, seen: Set<string> = new Set()): Set<string> {
  if (exportedProvidersCache.has(moduleFile)) {
    return exportedProvidersCache.get(moduleFile)!
  }
  if (seen.has(moduleFile)) {
    return new Set()
  }
  seen.add(moduleFile)

  const info = infos.get(moduleFile)
  const result = new Set<string>()
  if (!info) {
    return result
  }
  for (const provider of info.providerClasses) {
    if (info.exportedIds.includes(provider)) {
      result.add(provider)
    }
  }
  for (const exported of info.exportedIds) {
    const child = moduleByClass.get(exported)
    if (child !== undefined) {
      for (const provider of exportedClassProviders(child, seen)) {
        result.add(provider)
      }
    }
  }

  exportedProvidersCache.set(moduleFile, result)
  return result
}

interface ScopedModuleReport {
  file: string
  moduleClass: string
  isGlobal: boolean
  hasTokenBinding: boolean
  /** 本模块自己的类 provider（框架内置类如 Reflector 已排除） */
  providerClasses: string[]
  /** 通过任意注入形态引用过本模块 provider 的文件（诊断 + A2 自检） */
  injectingFiles: string[]
  /** provider 类名 → 声明了「注入它的类」的模块文件（A2：含 controllers[] 与属性级 @Inject） */
  consumersByProvider: Map<string, string[]>
  /** 全部消费方模块 */
  consumerModules: string[]
}

const reports: ScopedModuleReport[] = []
for (const [file, info] of infos) {
  if (!SCOPED_MODULE_FILE_RE.test(file)) {
    continue
  }
  const providerClasses = info.providerClasses.filter(provider => repoDeclaredClasses.has(provider))
  const consumersByProvider = new Map<string, string[]>(providerClasses.map(provider => [provider, []]))
  const injectingFiles = new Set<string>()

  for (const [candidate, candidateInfo] of infos) {
    if (candidate === file) {
      continue
    }
    for (const provider of providerClasses) {
      if ([...candidateInfo.injections].some(([, injected]) => injected.has(provider))) {
        injectingFiles.add(candidate)
      }
    }
  }

  /**
   * 宿主模块 = 把注入方**类**登记进 providers / controllers 的那个模块。
   * 若消费方模块自己也 provide 了同名类，注入落在它自己的副本上，不算本模块的消费方
   * （SysLocaleBasicRepository 就被 SysLocaleModule 与 SysLocaleSharedModule 各 provide 一份）。
   */
  for (const [candidate, candidateInfo] of infos) {
    if (candidate === file || !candidate.endsWith('.module.ts')) {
      continue
    }
    const declared = [...candidateInfo.providerClasses, ...candidateInfo.controllerClasses]
    for (const provider of providerClasses) {
      if (candidateInfo.providerClasses.includes(provider)) {
        continue
      }
      const injecting = declared.filter(className =>
        (injectionsByClass.get(className) ?? new Set<string>()).has(provider))
      if (injecting.length > 0) {
        consumersByProvider.get(provider)!.push(candidate)
      }
    }
  }

  const consumerModules = new Set<string>()
  for (const consumers of consumersByProvider.values()) {
    for (const consumer of consumers) {
      consumerModules.add(consumer)
    }
  }

  reports.push({
    file,
    moduleClass: info.classes.find(name => name.endsWith('Module')) ?? '',
    isGlobal: info.isGlobal,
    hasTokenBinding: info.hasTokenBinding,
    providerClasses,
    injectingFiles: [...injectingFiles],
    consumersByProvider,
    consumerModules: [...consumerModules],
  })
}

const rel = (file: string) => relative(SERVER_ROOT, file).split(sep).join('/')
const reportByPath = (path: string) => reports.find(report => rel(report.file) === path)

describe('d10 repo / shared 模块的 @Global 判据：消费方模块数 ≥ 2', () => {
  it('扫描口径有效（防「扫不到文件 ⇒ 全绿」）', () => {
    expect(reports.length).toBeGreaterThanOrEqual(20)
    // A1：两种形态都在扫描面内
    expect(reports.some(report => /\.repo\.module\.ts$/.test(report.file))).toBe(true)
    expect(reports.some(report => /\.shared\.module\.ts$/.test(report.file))).toBe(true)
    expect(reports.some(report => report.isGlobal)).toBe(true)
    expect(reports.some(report => !report.isGlobal)).toBe(true)
    // A5：libs/system/src/logs 源码子树必须在扫描面内（裸名 'logs' 剪枝会让它整棵消失）
    expect(reportByPath('libs/system/src/logs/auth/shared/log.auth.shared.module.ts')).toBeDefined()
    expect(reportByPath('libs/system/src/logs/auth/repo/log.auth.repo.module.ts')).toBeDefined()
  })

  it('判据 a2：消费方计数同时含 controllers[] 与属性级 @Inject', () => {
    const shared = reportByPath('libs/system/src/logs/auth/shared/log.auth.shared.module.ts')!
    // controllers[]：AuthOpaqueUserController 的宿主模块必须被算成消费方（只建 providers 映射时是 0）
    expect(shared.consumerModules.map(rel)).toContain('apps/api/src/modules/auth/auth-http.module.ts')
    // 属性级 @Inject：mixin 工厂里的 @Inject(SysLogAuthSharedService) 也要被看见
    expect(shared.injectingFiles.map(rel)).toContain('libs/guards/src/guards/auth.guard.ts')
    expect(shared.injectingFiles.map(rel)).toContain('libs/guards/src/decorators/log.auth.decorator.ts')
  })

  it('判据 ①：消费方 ≤ 1 时不许 @Global', () => {
    const offenders = reports
      .filter(report => report.isGlobal && !report.hasTokenBinding && report.consumerModules.length <= 1)
      .map(report => `  ${rel(report.file)}（消费方 ${report.consumerModules.length}：${report.consumerModules.map(rel).join(', ') || '无'}）`)

    expect(offenders).toEqual([])
  })

  it('判据 ①b：消费方 ≥ 2 的 @Global 必须在模块注释里登记理由', () => {
    const offenders = reports
      .filter(report => report.isGlobal && !report.hasTokenBinding && report.consumerModules.length >= 2)
      .filter(report => !/@Global/.test(infos.get(report.file)?.commentText ?? ''))
      .map(report => `${rel(report.file)}（消费方 ${report.consumerModules.length}）没在模块注释里登记 @Global 理由`)

    expect(offenders).toEqual([])
  })

  it('判据 ②：非 @Global 模块的每个消费方都能经 imports 看见它（含 re-export 与数组展开）', () => {
    const offenders: string[] = []
    for (const report of reports) {
      if (report.isGlobal) {
        continue
      }
      for (const [provider, consumers] of report.consumersByProvider) {
        for (const consumer of consumers) {
          const consumerInfo = infos.get(consumer)
          const visible = new Set<string>()
          for (const imported of consumerInfo?.importedIds ?? []) {
            const child = moduleByClass.get(imported)
            if (child !== undefined) {
              for (const exported of exportedClassProviders(child)) {
                visible.add(exported)
              }
            }
          }
          if (!visible.has(provider)) {
            offenders.push(`${rel(consumer)} 注入了 ${rel(report.file)} 的 [${provider}]，但 imports 闭包里看不见它`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('回归：SysLogAuthSharedModule 不再是 @Global，且消费方恰好是 AuthHttpModule', () => {
    const shared = reportByPath('libs/system/src/logs/auth/shared/log.auth.shared.module.ts')!
    expect(shared.isGlobal).toBe(false)
    expect(shared.hasTokenBinding).toBe(false)
    expect(shared.consumerModules.map(rel)).toEqual(['apps/api/src/modules/auth/auth-http.module.ts'])

    // 判据 ② 的具体形态：AuthHttpModule 的 imports 闭包里必须有 SysLogAuthSharedService
    const visible = new Set<string>()
    for (const imported of infos.get(shared.consumerModules[0])!.importedIds) {
      const child = moduleByClass.get(imported)
      if (child !== undefined) {
        for (const exported of exportedClassProviders(child)) {
          visible.add(exported)
        }
      }
    }
    expect(visible.has('SysLogAuthSharedService')).toBe(true)
  })
})

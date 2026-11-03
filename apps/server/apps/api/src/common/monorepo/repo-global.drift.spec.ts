import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * D10：Repository 的 `@Global` 判据 —— 机械版。
 *
 * 「三种 Repository 模式」收敛成两种形态（Repository + Shared Service）后，前两种的差别
 * 只剩「文件落哪」与「要不要 @Global」。@Global 的唯一判据是**消费方模块数 ≥ 2**
 * （口径见 apps/server/AGENTS.md 的「Repository 与 Shared Service」）：
 *
 * - 判据 ①（禁止滥用）：纯类 provider 的 `*.repo.module.ts`，消费方模块 ≤ 1 时**不许**
 *   @Global —— @Global 唯一的作用是「省掉 N 个模块的 import」；只有一个消费方时它只做
 *   一件事：把真实依赖从 imports 图上抹掉。
 * - 判据 ②（防假绿）：非 @Global 的 `*.repo.module.ts`，每个**实际注入了**它 provider 的
 *   模块都必须能通过 imports 看见它（直连，或经上层的 `exports: [SomeRepoModule]`
 *   转出口 —— SysDeptModule 就是后者）。否则这条注入靠的是别的路径（模块被别处间接引入、
 *   或又被偷偷改回 @Global），**只有 Nest 启动期才会炸**，类型检查与单测都看不见。
 *
 * 例外（ADR 0022 Decision 3 / D12）：模块同时**绑定 `WALNUT_ADMIN_*` 端口**
 * （providers 里有 `{ provide: TOKEN, ... }`）时，@Global 是端口可见性要求的，不适用判据 ①。
 *
 * 手段：只读源码 + TypeScript 解析器（不 import 应用代码、不需要 DB / Redis）。
 */

const SERVER_ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'logs', 'coverage', 'env-local', 'env-encrypted', 'public'])
const REPO_MODULE_RE = /\.repo\.module\.ts$/

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
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
  /** 文件里声明的类名 */
  classes: string[]
  /** 构造器参数的类型名（值注入：`private readonly x: SomeService`） */
  ctorTypes: Set<string>
  /** 构造器参数上的 `@Inject(TOKEN)` 名字 */
  injectTokens: Set<string>
  /** `@Module({ providers: [...] })` 里的类 provider */
  providerClasses: string[]
  /** `@Module({ imports: [...] })` 里的标识符 */
  importedIds: string[]
  /** `@Module({ exports: [...] })` 里的标识符 */
  exportedIds: string[]
  /** providers 里是否存在 token 绑定（`{ provide: X, ... }`） */
  hasTokenBinding: boolean
}

function readArrayProperty(arg: ts.ObjectLiteralExpression, sf: ts.SourceFile, name: string): string[] {
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
    }
  }
  return ids
}

function scan(file: string): FileInfo {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true)
  const info: FileInfo = {
    classes: [],
    ctorTypes: new Set(),
    injectTokens: new Set(),
    providerClasses: [],
    importedIds: [],
    exportedIds: [],
    hasTokenBinding: false,
  }

  for (const node of sf.statements) {
    if (!ts.isClassDeclaration(node) || !node.name) {
      continue
    }
    info.classes.push(node.name.text)

    for (const member of node.members) {
      if (!ts.isConstructorDeclaration(member)) {
        continue
      }
      for (const param of member.parameters) {
        if (param.type && ts.isTypeReferenceNode(param.type)) {
          info.ctorTypes.add(param.type.typeName.getText(sf))
        }
        for (const decorator of (ts.getDecorators?.(param) ?? [])) {
          const token = decorator.getText(sf).match(/@Inject\(\s*([\w.]+)\s*\)/)
          if (token) {
            info.injectTokens.add(token[1])
          }
        }
      }
    }

    const moduleDecorator = (ts.getDecorators?.(node) ?? [])
      .find(decorator => decorator.expression.getText(sf).startsWith('Module'))
    const arg = moduleDecorator && ts.isCallExpression(moduleDecorator.expression)
      ? moduleDecorator.expression.arguments[0]
      : undefined
    if (!arg || !ts.isObjectLiteralExpression(arg)) {
      continue
    }

    info.providerClasses = readArrayProperty(arg, sf, 'providers')
    info.importedIds = readArrayProperty(arg, sf, 'imports')
    info.exportedIds = readArrayProperty(arg, sf, 'exports')
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

  return info
}

const allFiles = walkTsFiles(SERVER_ROOT)
const isTestFile = (file: string) => /[\\/](?:test|__tests__)[\\/]/.test(file) || file.endsWith('.spec.ts')
const infos = new Map(allFiles.filter(file => !isTestFile(file)).map(file => [file, scan(file)]))

/** 模块类名 → 文件 */
const moduleByClass = new Map<string, string>()
/** 类名 → 声明它的模块（只认 identifier provider，即 Repository / Service 的常规落法） */
const classOwnerModules = new Map<string, string[]>()
for (const [file, info] of infos) {
  if (!file.endsWith('.module.ts')) {
    continue
  }
  const moduleClass = info.classes.find(name => name.endsWith('Module'))
  if (moduleClass !== undefined) {
    moduleByClass.set(moduleClass, file)
  }
  for (const provider of info.providerClasses) {
    classOwnerModules.set(provider, [...(classOwnerModules.get(provider) ?? []), file])
  }
}

/**
 * 模块对外可见的类 provider 集合：自己 `exports` 的 provider，加上它 re-export 的
 * 子模块（`exports: [SomeModule]`）递归带出的那些。Nest 的可见性按模块算，所以
 * 判据 ② 必须按这个闭包判，不能只看「有没有直接 import」。
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

interface RepoModuleReport {
  file: string
  moduleClass: string
  isGlobal: boolean
  hasTokenBinding: boolean
  providerClasses: string[]
  /** 声明了「注入本模块某个类 provider」的模块 */
  consumerModules: string[]
}

const reports: RepoModuleReport[] = []
for (const [file, info] of infos) {
  if (!REPO_MODULE_RE.test(file)) {
    continue
  }
  const consumerModules = new Set<string>()
  for (const [candidate, candidateInfo] of infos) {
    if (candidate === file) {
      continue
    }
    const injects = info.providerClasses.some(provider =>
      candidateInfo.ctorTypes.has(provider) || candidateInfo.injectTokens.has(provider))
    if (!injects) {
      continue
    }
    for (const declared of candidateInfo.classes) {
      for (const owner of classOwnerModules.get(declared) ?? []) {
        consumerModules.add(owner)
      }
    }
  }
  reports.push({
    file,
    moduleClass: info.classes.find(name => name.endsWith('Module')) ?? '',
    isGlobal: /@Global\(\)/.test(readFileSync(file, 'utf8')),
    hasTokenBinding: info.hasTokenBinding,
    providerClasses: info.providerClasses,
    consumerModules: [...consumerModules],
  })
}

const rel = (file: string) => relative(SERVER_ROOT, file).split(sep).join('/')

describe('d10 repository @Global 判据：消费方模块 ≥ 2', () => {
  it('扫描口径有效（防「扫不到文件 ⇒ 全绿」）', () => {
    expect(reports.length).toBeGreaterThanOrEqual(10)
    expect(reports.some(report => report.isGlobal)).toBe(true)
    expect(reports.some(report => !report.isGlobal)).toBe(true)
  })

  it('纯类 provider 的 repo 模块，消费方 ≤ 1 时不许 @Global', () => {
    const offenders = reports
      .filter(report => report.isGlobal && !report.hasTokenBinding && report.consumerModules.length <= 1)
      .map(report => `${rel(report.file)}（消费方 ${report.consumerModules.length}：${report.consumerModules.map(rel).join(', ') || '无'}）`)

    expect(offenders).toEqual([])
  })

  it('非 @Global 的 repo 模块，每个消费方模块都必须能经 imports 看见它（含 re-export）', () => {
    const offenders: string[] = []
    for (const report of reports) {
      if (report.isGlobal) {
        continue
      }
      for (const consumer of report.consumerModules) {
        const consumerInfo = infos.get(consumer)
        const visible = new Set<string>()
        for (const imported of consumerInfo?.importedIds ?? []) {
          const child = moduleByClass.get(imported)
          if (child !== undefined) {
            for (const provider of exportedClassProviders(child)) {
              visible.add(provider)
            }
          }
        }
        const invisible = report.providerClasses.filter(provider => !visible.has(provider))
        if (invisible.length > 0) {
          offenders.push(`${rel(consumer)} 注入了 ${rel(report.file)} 的 [${invisible.join(', ')}]，但 imports 闭包里看不见它`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})

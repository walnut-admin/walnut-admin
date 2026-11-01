/**
 * 三方一致门禁：`src/<x>.ts` 公共模块 ⇄ `vite.config.ts` 的 build.lib entries ⇄
 * `src/index.ts` 选择性 barrel ⇄ `package.json` exports 子路径。
 *
 * 这几处此前全靠人工同步 —— 漏登记的症状是**静默**的：dist 少了产物、子路径 import 404、
 * 或 barrel 里少一个值，直到某个消费者踩到才暴露。这里用文本解析把缺口变成红测试。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const srcDir = resolve(packageRoot, 'src')

function read(relativePath: string): string {
  return readFileSync(resolve(packageRoot, relativePath), 'utf8')
}

/** `src/` 下的公共模块名（不含 index / 测试 / 快照） */
function publicModules(): string[] {
  return readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.ts'))
        return false
      return entry.name !== 'index.ts'
        && !entry.name.endsWith('.test.ts')
        && !entry.name.endsWith('.spec.ts')
        && !entry.name.endsWith('.d.ts')
    })
    .map(entry => entry.name.slice(0, -'.ts'.length))
    .sort()
}

interface ViteEntry {
  key: string
  module: string
}

/** 从 vite.config.ts 文本提取 entries（`'x': resolve(__dirname, 'src/x.ts')`） */
function viteEntries(): ViteEntry[] {
  const source = read('vite.config.ts')
  const pattern = /['"]?([\w-]+)['"]?:\s*resolve\(\s*__dirname\s*,\s*['"]src\/([^'"]+)\.ts['"]\s*\)/g
  return [...source.matchAll(pattern)].map(match => ({ key: match[1]!, module: match[2]! }))
}

/** 从 src/index.ts 提取「模块 → 具名导出集合」的映射 */
function barrelExports(): Map<string, Set<string>> {
  const source = read('src/index.ts')
  const map = new Map<string, Set<string>>()
  const pattern = /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]\.\/([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const names = match[1]!
    const moduleName = match[2]!
    const set = map.get(moduleName) ?? new Set<string>()
    for (const raw of names.split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim()
      if (name)
        set.add(name)
    }
    map.set(moduleName, set)
  }
  return map
}

/** 解析模块源码里声明的导出名（const / function / class / interface / type / enum + 具名列表） */
function declaredExports(moduleName: string): string[] {
  const source = read(`src/${moduleName}.ts`)
  const names = new Set<string>()
  const declaration = /export\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
  for (const match of source.matchAll(declaration))
    names.add(match[1]!)
  const list = /export\s+(?:type\s+)?\{([^}]*)\}/g
  for (const match of source.matchAll(list)) {
    for (const raw of match[1]!.split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim()
      if (name)
        names.add(name)
    }
  }
  return [...names]
}

interface PackageManifest {
  exports?: Record<string, unknown>
}

function packageExports(): Record<string, unknown> {
  const manifest = JSON.parse(read('package.json')) as PackageManifest
  return manifest.exports ?? {}
}

/** 按 Node 的 exports 模式规则（最长前缀）解析子路径 */
function resolveExportSubpath(exportsMap: Record<string, unknown>, subpath: string): unknown {
  if (Object.hasOwn(exportsMap, subpath))
    return exportsMap[subpath]

  let best: { base: string, trailer: string, target: unknown } | undefined
  for (const [key, target] of Object.entries(exportsMap)) {
    const star = key.indexOf('*')
    if (star < 0)
      continue
    const base = key.slice(0, star)
    const trailer = key.slice(star + 1)
    if (!subpath.startsWith(base) || !subpath.endsWith(trailer) || subpath.length < base.length + trailer.length)
      continue
    if (!best || base.length > best.base.length)
      best = { base, trailer, target }
  }
  if (!best)
    return undefined

  const wildcard = subpath.slice(best.base.length, subpath.length - best.trailer.length)
  return substituteWildcard(best.target, wildcard)
}

function substituteWildcard(target: unknown, wildcard: string): unknown {
  if (typeof target === 'string')
    return target.replaceAll('*', wildcard)
  if (Array.isArray(target))
    return target.map(item => substituteWildcard(item, wildcard))
  if (target && typeof target === 'object') {
    return Object.fromEntries(
      Object.entries(target).map(([key, value]) => [key, substituteWildcard(value, wildcard)]),
    )
  }
  return target
}

describe('entries / barrel / exports drift gate', () => {
  const modules = publicModules()
  const entries = viteEntries()

  it('discovers every public module and the entries block', () => {
    expect(modules.length, 'src/ 下没有发现任何公共模块').toBeGreaterThan(0)
    expect(entries.length, 'vite.config.ts 里没有解析到任何 entry').toBeGreaterThan(0)
  })

  it('every public module has a vite entry and no entry is orphaned', () => {
    const problems: string[] = []
    const entryKeys = new Set(entries.map(entry => entry.key))

    if (!entryKeys.has('index'))
      problems.push('vite.config.ts is missing the "index" entry → src/index.ts')

    for (const entry of entries) {
      if (entry.key !== entry.module)
        problems.push(`entry "${entry.key}" resolves src/${entry.module}.ts — entry key must match the file name`)
      if (!existsSync(resolve(srcDir, `${entry.module}.ts`)))
        problems.push(`orphan entry "${entry.key}" — src/${entry.module}.ts does not exist`)
    }

    if (entryKeys.size !== entries.length)
      problems.push('vite.config.ts declares duplicate entry keys')

    for (const module of modules) {
      if (!entryKeys.has(module))
        problems.push(`src/${module}.ts is missing a vite build.lib entry (expected '${module}': resolve(__dirname, 'src/${module}.ts'))`)
    }

    expect(problems).toEqual([])
  })

  it('vite entry key set equals the public modules plus the "index" barrel', () => {
    const entryKeys = [...new Set(entries.map(entry => entry.key))].sort()
    const expected = [...modules, 'index'].sort()
    expect(entryKeys).toEqual(expected)
  })

  it('every public module is re-exported by the src/index.ts named barrel', () => {
    const problems: string[] = []
    const barrel = barrelExports()
    const barrelSource = read('src/index.ts')

    if (/export\s+\*\s+from/.test(barrelSource))
      problems.push('src/index.ts uses `export *` — the barrel must re-export names selectively (ADR 0013)')

    for (const module of modules) {
      const moduleSource = read(`src/${module}.ts`)
      if (/export\s+default/.test(moduleSource))
        problems.push(`src/${module}.ts uses a default export — public modules must expose named exports`)

      const exported = barrel.get(module)
      if (!exported) {
        problems.push(`src/index.ts does not re-export anything from './${module}'`)
        continue
      }
      for (const name of declaredExports(module)) {
        if (!exported.has(name))
          problems.push(`src/${module}.ts exports "${name}" but src/index.ts does not re-export it from './${module}'`)
      }
    }

    for (const module of barrel.keys()) {
      if (!existsSync(resolve(srcDir, `${module}.ts`)))
        problems.push(`src/index.ts re-exports from './${module}' but src/${module}.ts does not exist`)
    }

    expect(problems).toEqual([])
  })

  it('every public module resolves through a package.json exports subpath', () => {
    const problems: string[] = []
    const exportsMap = packageExports()

    for (const module of modules) {
      const target = resolveExportSubpath(exportsMap, `./${module}`)
      if (!target) {
        problems.push(`package.json exports has no subpath for './${module}' (explicit key or wildcard pattern)`)
        continue
      }
      if (typeof target !== 'object' || Array.isArray(target)) {
        problems.push(`package.json exports['./${module}'] must be a condition object, got ${JSON.stringify(target)}`)
        continue
      }

      const conditions = target as Record<string, unknown>
      const expected: Record<string, string> = {
        source: `./src/${module}.ts`,
        types: `./src/${module}.ts`,
        import: `./src/${module}.ts`,
        require: `./dist/${module}.cjs`,
        default: `./dist/${module}.cjs`,
      }
      for (const [condition, expectedTarget] of Object.entries(expected)) {
        if (conditions[condition] !== expectedTarget)
          problems.push(`package.json exports['./${module}'].${condition} is ${String(conditions[condition])} — expected ${expectedTarget}`)
      }
    }

    expect(problems).toEqual([])
  })
})

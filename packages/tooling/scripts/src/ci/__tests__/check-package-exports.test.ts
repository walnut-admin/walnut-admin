import type { WorkspacePackage } from '../../lib/workspace.ts'
/**
 * `check-package-exports.ts` 的用例。
 *
 * 三段各自防一种失败：
 *   1. **纯函数**（`flattenExportTargets` / `typesComesFirst`）—— 判据本身对不对；
 *   2. **夹具包**（内存里造 manifest + 真实临时目录）—— 四条不变量真的会红，含**负对照**；
 *   3. **真仓**—— 当前是绿的（"上了就是绿的"），且扫描面非空（防解析退化后永远绿）。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import { workspacePackages } from '../../lib/workspace.ts'
import { collectFindings, flattenExportTargets, typesComesFirst } from '../check-package-exports.ts'

describe('flattenExportTargets', () => {
  it('摊平字符串形态', () => {
    expect(flattenExportTargets('p', { './base': './base.ts' }).map(t => t.target)).toEqual(['./base.ts'])
  })

  it('摊平嵌套条件形态（label 要能一眼定位：子路径一种写法、条件一种写法）', () => {
    const targets = flattenExportTargets('p', {
      '.': { source: './src/index.ts', types: './src/index.ts', require: './dist/index.cjs' },
      './*': { import: './src/*.ts' },
    })
    expect(targets.map(t => t.target)).toEqual(['./src/index.ts', './src/index.ts', './dist/index.cjs', './src/*.ts'])
    // 第一版把子路径与条件混在一条字符串里，报出来是 `exports[""../broken]` 这种读不懂的东西（实测）
    expect(targets[0]!.label).toBe('p exports["."].source')
    expect(targets[3]!.label).toBe('p exports["./*"].import')
  })

  it('忽略 null / 非字符串（`exports: null` 是合法写法）', () => {
    expect(flattenExportTargets('p', { '.': null, './x': 42 })).toEqual([])
  })
})

describe('typesComesFirst', () => {
  it('没有 types 条件 ⇒ 不管顺序', () => {
    expect(typesComesFirst(['import', 'require'])).toBe(true)
  })

  it('types 在 import / require / default 之前 ⇒ 通过', () => {
    expect(typesComesFirst(['types', 'import', 'require', 'default'])).toBe(true)
    // 本仓真实形态：`source` 写在 types 前面 —— 那不是解析条件，不该算违规（实测：要求置顶会误报 5 个包）
    expect(typesComesFirst(['source', 'types', 'import', 'require', 'default'])).toBe(true)
  })

  it('types 排在 import / require / default 之后 ⇒ 违规（类型静默丢失）', () => {
    expect(typesComesFirst(['import', 'types'])).toBe(false)
    expect(typesComesFirst(['require', 'default', 'types'])).toBe(false)
  })
})

describe('collectFindings —— 夹具包（负对照）', () => {
  /** 造一个真实临时目录 + 若干文件的夹具；`ignore` 注入 gitignore 集合（不真的去问 git） */
  function fixture(files: string[]): { cwd: string, ignore: (p: Iterable<string>) => Set<string> } {
    const cwd = mkdtempSync(path.join(tmpdir(), 'walnut-exports-'))
    for (const f of files) {
      const abs = path.join(cwd, f)
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, '// x\n')
    }
    return { cwd, ignore: () => new Set() }
  }

  const pkg = (dir: string, exportsField: unknown, extra: Record<string, unknown> = {}): WorkspacePackage => ({
    dir,
    manifest: { name: `@x/${path.basename(dir)}`, exports: exportsField, ...extra },
  })

  it('字面量目标不存在 → exports-target-exists', () => {
    const { cwd, ignore } = fixture(['pkg/src/index.ts'])
    const found = collectFindings([pkg('pkg', { '.': './src/nope.ts' })], ignore, cwd)
    expect(found.map(f => f.rule)).toEqual(['exports-target-exists'])
    expect(found[0]!.detail).toContain('./src/nope.ts')
  })

  it('通配目标一个都没命中 → exports-glob-matches', () => {
    const { cwd, ignore } = fixture(['pkg/sr/index.ts'])
    const found = collectFindings([pkg('pkg', { './*': './src/*.ts' })], ignore, cwd)
    expect(found.map(f => f.rule)).toEqual(['exports-glob-matches'])
  })

  it('通配目标命中 ≥1 个 → 不报', () => {
    const { cwd, ignore } = fixture(['pkg/src/a.ts', 'pkg/src/b.ts'])
    expect(collectFindings([pkg('pkg', { './*': './src/*.ts' })], ignore, cwd)).toEqual([])
  })

  it('`types` 排在 import 之后 → types-condition-order', () => {
    const { cwd, ignore } = fixture(['pkg/src/index.ts', 'pkg/dist/index.cjs'])
    const found = collectFindings([pkg('pkg', { '.': { import: './src/index.ts', types: './src/index.ts' } })], ignore, cwd)
    expect(found.map(f => f.rule)).toEqual(['types-condition-order'])
  })

  it('顶层 main 与 exports["."].require 不一致 → root-conditions-match-top-level', () => {
    const { cwd, ignore } = fixture(['pkg/src/index.ts', 'pkg/dist/index.cjs'])
    const found = collectFindings(
      [pkg('pkg', { '.': { types: './src/index.ts', require: './dist/index.cjs' } }, { main: './dist/other.cjs' })],
      ignore,
      cwd,
    )
    expect(found.map(f => f.rule)).toEqual(['root-conditions-match-top-level'])
  })

  it('目标是 gitignore 的产物 → 不查存在性（干净检出里它本来就不在）', () => {
    const { cwd } = fixture(['pkg/src/index.ts'])
    const ignore = (paths: Iterable<string>) => new Set([...paths].filter(p => p.includes('/dist/')))
    expect(collectFindings([pkg('pkg', { '.': { types: './src/index.ts', require: './dist/index.cjs' } })], ignore, cwd)).toEqual([])
  })

  it('`exports` 写成字符串 → 报（本仓一律用对象形态表达子路径）', () => {
    const { cwd, ignore } = fixture(['pkg/src/index.ts'])
    expect(collectFindings([pkg('pkg', './src/index.ts')], ignore, cwd).map(f => f.rule)).toEqual(['exports-target-exists'])
  })

  it('没有 `exports` 的包完全不管（工具链包有没有 exports 是有意的差异）', () => {
    const { cwd, ignore } = fixture([])
    expect(collectFindings([{ dir: 'pkg', manifest: { name: '@x/none' } }], ignore, cwd)).toEqual([])
  })
})

describe('collectFindings —— 对着真实仓库跑', () => {
  it('本仓当前全绿（上了就是绿的）', () => {
    expect(collectFindings().map(f => `${f.rule} :: ${f.detail}`)).toEqual([])
  })

  it('扫描面非空：确实有包声明了 `exports`（防解析退化后永远绿）', () => {
    const withExports = workspacePackages().filter(p => p.manifest.exports !== undefined)
    expect(withExports.length).toBeGreaterThan(5)
  })

  it('rEPO_ROOT 可用（夹具之外的判据都基于它）', () => {
    expect(workspacePackages().length).toBeGreaterThan(10)
    expect(REPO_ROOT.length).toBeGreaterThan(0)
  })
})

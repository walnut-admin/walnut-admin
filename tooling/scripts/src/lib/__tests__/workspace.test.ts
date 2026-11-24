/**
 * 包目录形态谓词（`isWorkspacePackageDir`）与 `pnpm-workspace.yaml` 的对账。
 *
 * 为什么必须有它：`workspacePackages()` 与 `@walnut/release` 的归属逻辑都靠这条谓词认包目录，
 * 而正则与 `pnpm-workspace.yaml` 的 `packages` 字段是**两份手写清单**。目录组一调（例如
 * tooling 从 `packages/` 提到仓库根），正则不改就**静默跳过**整组包 —— 门禁照绿、发版照跑，
 * 只是扫描面少了一截。这条测试把两份清单钉在一起：workspace glob 能匹配的目录，谓词必须认下。
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { REPO_ROOT } from '../repo-root.ts'
import { isWorkspacePackageDir } from '../workspace.ts'

/** `pnpm-workspace.yaml` 的 `packages` glob（唯一真源） */
function workspaceGlobs(): string[] {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const parsed = parseYaml(raw) as { packages?: unknown }
  return Array.isArray(parsed.packages) ? parsed.packages.map(String) : []
}

/** 把 glob 里的每个 `*` 换成占位段，得到一个具体目录 */
function sampleDir(glob: string): string {
  return glob.replaceAll('*', 'sample')
}

describe('isWorkspacePackageDir —— 与 pnpm-workspace.yaml 的 packages 字段逐条对应', () => {
  it('workspace glob 的每个样本目录都被认下', () => {
    const globs = workspaceGlobs()
    expect(globs.length).toBeGreaterThan(0)
    for (const glob of globs)
      expect(isWorkspacePackageDir(sampleDir(glob)), `glob ${glob} 的样本目录应被认下`).toBe(true)
  })

  it('接受三种形态：apps/<x>、tooling/<x>、packages/<组>/<x>', () => {
    for (const dir of ['apps/admin', 'tooling/scripts', 'packages/platform-any/contract'])
      expect(isWorkspacePackageDir(dir), dir).toBe(true)
  })

  it('拒绝根、目录组本身与过深 / 过浅的路径', () => {
    const rejected = [
      '.', // 仓库根
      'packages', // 目录组
      'packages/platform-any', // 组内层（没有包目录段）
      'tooling', // 目录组
      'apps', // 目录组
      'apps/server/apps/api', // 后端内部 lib 不是 workspace 包
      'tooling/scripts/nested', // 嵌套目录不是包目录
      'docs', // 顶层非组目录
    ]
    for (const dir of rejected)
      expect(isWorkspacePackageDir(dir), dir).toBe(false)
  })
})

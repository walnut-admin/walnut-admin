/**
 * `clean:all` 的清理面：把全仓的 `node_modules` 删掉（各 workspace 包的、仓库根的、镜像 staging 的）。
 *
 * ## 为什么不用 rimraf
 *
 * 根脚本此前写的是 `rimraf node_modules apps/…/node_modules …`（各 workspace 包的 node_modules）。在本仓的
 * Windows 环境下它从来没工作过，而且坏在两层上（2026-11-23 逐条验证时实测）：
 *
 * 1. rimraf 6 默认把参数当**字面路径**，带 `*` 的路径直接报 `Illegal characters in path`（要显式 `--glob`）；
 * 2. 加上 `--glob` 之后它会把**自己所在的**根 `node_modules` 一起删掉，`pnpm exec` 这层包装随后收尾失败
 *    ——目录删干净了，命令却以退出码 1 结束（在仓库外的一个空包里同样复现，不是本仓的问题）。
 *
 * 所以改成在入口进程里直接删：入口进程的代码住在仓库的源码目录里，不在 `node_modules` 里，
 * 结构上不存在「删到自己」这件事。
 *
 * ## 判据
 *
 * - **删哪些**：仓库根的 `node_modules`、`build/node_modules`（镜像 staging），以及 `apps/*`、
 *   `packages/<组>/*`、`tooling/*` 各目录下的 `node_modules` —— 与 `pnpm-workspace.yaml` 的 workspace glob 同形。
 *   刻意不按「有没有 `package.json`」筛：装到一半的目录同样要清。
 * - **不存在的不算失败**（重复跑安全）。
 * - **删不掉的逐个报出来**并以非零收场 ——「清干净了」必须是能核对的事实，不能靠退出码 0 暗示。
 * - **带重试**：Windows 上被编辑器、语言服务这类常驻进程占着的文件会先报 `EBUSY` / `EPERM`，稍等再删通常就过了。
 *
 * 本模块只有 `node:fs` / `node:path` 两个依赖，用例在临时目录里造一棵假树就能覆盖。
 */

import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './repo-root.ts'

/** 不随 workspace 布局变的两个目标（仓库相对路径）。根的那一个刻意排在最后 */
const FIXED_TARGETS = ['build/node_modules', 'node_modules'] as const

/** 某个目录下的子目录（仓库相对、正斜杠、已排序）。不存在或读不了就当没有 */
function subDirs(root: string, rel: string): string[] {
  const abs = path.join(root, rel)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true })
  } catch {
    return []
  }
  // 只认真目录：符号链接 / junction 不是包目录（pnpm 在 Windows 上用 junction 链依赖）
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => `${rel}/${entry.name}`)
    .sort()
}

/**
 * workspace 包目录，顺序与 `pnpm-workspace.yaml` 的声明一致：`apps/*`、`packages/<组>/*`、`tooling/*`。
 * `packages/` 比另外两个多一层（组 → 包）。
 */
function workspaceDirs(root: string): string[] {
  return [
    ...subDirs(root, 'apps'),
    ...subDirs(root, 'packages').flatMap((group) => subDirs(root, group)),
    ...subDirs(root, 'tooling'),
  ]
}

/**
 * 展开清理目标（仓库相对、正斜杠）。顺序稳定：先各包（按 workspace 声明的顺序），最后才是仓库根自己 ——
 * 根的 `node_modules` 是其余一切依赖的来源，放在最后删，中途失败时留下的现场更好判断。
 */
export function listCleanAllTargets(root: string = REPO_ROOT): string[] {
  return [...workspaceDirs(root).map((dir) => `${dir}/node_modules`), ...FIXED_TARGETS]
}

export interface CleanAllResult {
  /** 实际存在的目标里，删掉的（仓库相对路径） */
  removed: string[]
  /** 删不掉的：路径与原因。非空 = 没清干净 */
  failed: { dir: string; error: string }[]
}

/** 缺省的删除动作。抽成参数只为让用例能造出「删不掉」的分支 —— 生产路径一律用它 */
export type RemoveDir = (abs: string) => void

const removeDir: RemoveDir = (abs) => {
  // Windows 上被占用的文件先报 EBUSY / EPERM：重试几次，仍不行才交给调用方记为失败
  fs.rmSync(abs, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

/**
 * 执行清理。不存在的目标直接跳过（重复跑安全）；删不掉的记进 `failed`，由调用方决定怎么收场。
 * 这里不打印、不抛 —— 它是纯的「删」，口径与出口交给调用方。
 */
export function cleanAll(
  root: string = REPO_ROOT,
  targets: string[] = listCleanAllTargets(root),
  remove: RemoveDir = removeDir,
): CleanAllResult {
  const result: CleanAllResult = { removed: [], failed: [] }
  for (const rel of targets) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    try {
      remove(abs)
      result.removed.push(rel)
    } catch (error) {
      result.failed.push({
        dir: rel,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

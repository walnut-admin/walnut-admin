/**
 * workspace 包的枚举。
 *
 * **一份真源**：`git ls-files --cached --others --exclude-standard '*package.json'` ——
 * 它有两条别的做法都没有的性质：
 *   · 只认**入库或未被忽略**的文件（`node_modules/**` 里成百上千个 package.json 自动出局）；
 *   · **新增的包还没 `git add` 也算**（`--others`），而"刚加了一个包"正是这类门禁最该看见的时刻。
 *
 * 在此之前这段枚举在 `check-doc-refs.ts` 里（只要名字），`exports` 门禁又要一份（要目录 + manifest）。
 * 与其抄第二遍，不如按「**目录 + manifest**」这一档提供，名字那一档由它推出来。
 */
import fs from 'node:fs'
import path from 'node:path'

import { lsFilesWithUntracked } from './git.ts'
import { REPO_ROOT } from './repo-root.ts'

/** workspace 包的 manifest 里本模块关心（以及门禁常要）的字段 */
export interface PackageManifest {
  name?: string
  version?: string
  private?: boolean
  type?: string
  main?: string
  types?: string
  typings?: string
  exports?: unknown
  files?: unknown
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

export interface WorkspacePackage {
  /** 仓库相对、正斜杠的包目录（如 `tooling/scripts`） */
  dir: string
  manifest: PackageManifest
}

/**
 * 包目录的形态：`apps/<x>`、`tooling/<x>` 或 `packages/<组>/<x>`（根的 `package.json` 不算包）。
 *
 * 与 `pnpm-workspace.yaml` 的 `packages` 字段**逐条对应**（`apps/*`、`tooling/*`、
 * `packages/<组>/*`）；改目录组时两处必须一起改。`workspace.test.ts` 把这条对应关系钉住：
 * 它读 workspace glob、把每个 `*` 换成占位段，要求全部被本谓词认下。
 *
 * 为什么不直接读 `pnpm-workspace.yaml` 用 glob 匹配：本模块与 release 包的归属逻辑都只要
 * 「这个目录是不是包」，而 glob 库在这里是多余依赖；谓词保持纯函数，测试也简单。
 */
const PACKAGE_DIR = /^(?:apps\/[^/]+|tooling\/[^/]+|packages\/[^/]+\/[^/]+)$/

/** 该仓库相对目录是否是 workspace 包目录（`apps/<x>` / `tooling/<x>` / `packages/<组>/<x>`） */
export function isWorkspacePackageDir(dir: string): boolean {
  return PACKAGE_DIR.test(dir)
}

/** 每个 workspace 包的目录与 manifest（按目录排序，输出稳定） */
export function workspacePackages(): WorkspacePackage[] {
  const out: WorkspacePackage[] = []
  for (const file of lsFilesWithUntracked('*package.json')) {
    const dir = path.posix.dirname(file)
    if (!isWorkspacePackageDir(dir)) continue
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'),
      ) as PackageManifest
      if (manifest.name) out.push({ dir, manifest })
    } catch {
      // 读不动就当它不存在：本模块只做枚举，不做清单审计（那是 release 的活）
    }
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir))
}

/** 真实 workspace 包名（`workspacePackages()` 的投影） */
export function workspacePackageNames(): Set<string> {
  return new Set(workspacePackages().map((p) => p.manifest.name!))
}

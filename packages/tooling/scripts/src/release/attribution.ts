/**
 * 提交 → 包归属，以及 workspace / fixed 组的机械审计。
 *
 * ⚠️ 本模块在本仓的性质与参考仓不同，值得先说清：本仓是**单一 fixed 组**（全部 12 个包永远同版本），
 * 所以「归属到哪个包」不再影响版本号 —— 只要产生**一条**意图，整组就会被 bump 到同一个新版本。
 * 因此本模块真正决定的事情只有一件：**这条提交要不要产生意图**（= 要不要发版）。
 * 包名清单仍要写对，因为它进 `pnpm change` 的 argv、并由 `pnpm change check` 核对。
 *
 * 归属规则（按优先级）：
 *   ① **路径优先**：提交改动的文件落在哪个包目录下（最长前缀）；一个提交可以命中多个包。
 *   ② **scope 兜底**：路径一个包都没命中时，用 commit scope 查表（`type(包名): …`）。
 *   ③ **否则不产生意图**：基础设施 scope（docker / deploy / pnpm / release）、未在册的 scope、
 *      以及只动了仓库级文件（根配置、`.github/`、`deploy/`、文档站配置…）的提交 ——
 *      它们不该带动产品版本号。这一条是刻意设计，不是「变更丢失」：
 *      凡真动了某个包的文件，① 就会命中。
 */

import type { ParsedCommit } from './commit-intent.ts'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parse as parseYaml } from 'yaml'
import { PreconditionError } from '../lib/errors.ts'
import { lsFilesWithUntracked } from '../lib/git.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** commit scope（括号内的名字）→ workspace 包名。与 `@walnut/commitlint-config` 的包名段同口径。 */
export const SCOPE_TO_PACKAGE: Record<string, string> = {
  // apps
  'admin': '@walnut/admin',
  'server': '@walnut/server',
  'docs': '@walnut/docs',
  // platform-any
  'utils': '@walnut/utils',
  'contract': '@walnut/contract',
  'types': '@walnut/types',
  // platform-web
  'client': '@walnut/client',
  'http': '@walnut/http',
  'ui': '@walnut/ui',
  // tooling
  'eslint-config': '@walnut/eslint-config',
  'commitlint-config': '@walnut/commitlint-config',
  'tooling': '@walnut/tooling',
}

/**
 * 基础设施 scope：**刻意不归因**。
 *
 * 它们改的是仓库/部署本身，不是某个包；把它们算进来会让「改一行 CI 脚本」带动整个产品 minor。
 * 与 `@walnut/commitlint-config` 的 SCOPES 后半段一致（`release` 只用于发版记账提交
 * `chore(release): vX.Y.Z`，那种提交的 type 是 chore，本来就不会发版）。
 */
export const INFRA_SCOPES: readonly string[] = ['docker', 'deploy', 'pnpm', 'release']

/** 包外路径（根配置 / 部署 / CI / 文档站配置…）归到它，保住「每次发版主应用必有条目」这条不变量 */
export const MAIN_PACKAGE = '@walnut/admin'

/** workspace 包目录的形状：`apps/<x>` 或 `packages/<group>/<x>` */
const WORKSPACE_DIR_SHAPE = /^(?:apps\/[^/]+|packages\/[^/]+\/[^/]+)$/

export interface WorkspacePackage {
  /** 仓库相对目录，例如 `apps/admin` */
  dir: string
  name: string
  version: string | null
}

/** 全局排除：这几段不属于任何包，且不该被当成「改动落在包内」 */
const NON_PACKAGE_TOP_SEGMENTS = ['.github', '.vscode', '.changeset']

/**
 * 枚举 workspace 包 —— 从**盘上**现算（跟踪面 ∪ 未跟踪但未被忽略），不维护手写清单。
 *
 * 为什么走 git 而不是纯文件系统遍历：这样能自动排除 `node_modules`、`dist` 等被忽略的目录，
 * 不需要在本模块里再维护一份忽略清单。
 *
 * 为什么带 `--others`：pnpm 解析 workspace 时读的是盘上的 `package.json`。新增一个包、还没提交
 * 就发版时，只看跟踪面会把那个包判成「工作区不存在」，于是 fixed 组审计报出假警（实测踩到）。
 *
 * `lsFilesWithUntracked` 在 git 跑不动时是**抛**而不是返回空集：把「扫描面未知」静默收敛成
 * 「没有包」会让发版逻辑以为自己在一个空仓库里工作。
 */
export function workspacePackages(): WorkspacePackage[] {
  const packages: WorkspacePackage[] = []
  for (const file of lsFilesWithUntracked('*package.json')) {
    const dir = path.posix.dirname(file)
    if (dir === '.')
      continue
    if (!WORKSPACE_DIR_SHAPE.test(dir))
      continue
    const absolute = path.join(REPO_ROOT, file)
    // 被跟踪但盘上已不存在 = 删除还没进提交（`git ls-files` 只看索引）。
    // 这是**合法**的过渡状态（改名/删包之后、提交之前），跳过而不是抛错 ——
    // 真正的「组里有、工作区没有」由 auditFixedGroup() 的 unknown 集在提交后拦。
    if (!fs.existsSync(absolute))
      continue
    try {
      const manifest = JSON.parse(fs.readFileSync(absolute, 'utf8')) as {
        name?: string
        version?: string
      }
      if (!manifest.name)
        continue
      packages.push({ dir, name: manifest.name, version: manifest.version ?? null })
    }
    catch (error: any) {
      throw new PreconditionError(`读不动 workspace 清单 ${file}：${error?.message ?? error}`)
    }
  }
  return packages.sort((a, b) => a.dir.localeCompare(b.dir))
}

/** 该 workspace 包是否有版本号（= 该被 fixed 组覆盖的那些） */
export function versionedPackages(packages: WorkspacePackage[] = workspacePackages()): WorkspacePackage[] {
  return packages.filter(pkg => pkg.version !== null)
}

export interface WorkspaceVersioningConfig {
  fixed: string[][]
  changelogStorage: string | null
}

/**
 * 读 `pnpm-workspace.yaml` 的 `versioning` 段 —— 版本策略的**唯一真源**。
 *
 * 解析不出 `versioning.fixed` 即抛前置条件错：本仓的发版编排整套都建立在这段配置上，
 * 读不到就不该继续（而不是退化成一个「没有 fixed 组」的假象）。
 */
export function readVersioningConfig(): WorkspaceVersioningConfig {
  const configPath = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  }
  catch (error: any) {
    throw new PreconditionError(`读不到 pnpm-workspace.yaml（${configPath}）：${error?.message ?? error}`)
  }
  let parsed: any
  try {
    parsed = parseYaml(raw)
  }
  catch (error: any) {
    throw new PreconditionError(`pnpm-workspace.yaml 不是合法 YAML：${error?.message ?? error}`)
  }
  const versioning = parsed?.versioning
  if (!versioning || typeof versioning !== 'object')
    throw new PreconditionError('pnpm-workspace.yaml 里没有 versioning 段 —— 本仓的版本策略以它为唯一真源')
  const fixed = Array.isArray(versioning.fixed) ? versioning.fixed : []
  if (fixed.length === 0)
    throw new PreconditionError('pnpm-workspace.yaml 的 versioning.fixed 为空 —— 发版编排依赖它做整组锁步')
  return {
    fixed: fixed.map((group: unknown) => (Array.isArray(group) ? group.map(String) : [String(group)])),
    changelogStorage: versioning?.changelog?.storage ?? null,
  }
}

export interface FixedGroupAudit {
  /** 有版本号却不在任何 fixed 组里的包（漏登记） */
  missing: string[]
  /** 在 fixed 组里但工作区不存在（改了包名/删了包没同步） */
  unknown: string[]
  /** fixed 组里的包名重复出现 */
  duplicated: string[]
}

/**
 * 机械审计 fixed 组与实际 workspace 的一致性。
 *
 * 为什么要有它：`versioning.fixed` 是手写清单，新增/改名一个 workspace 包时最容易漏改。
 * `pnpm change check` 只校验「已在组内的包版本是否锁步」，**不校验是否所有包都在组内** ——
 * 漏登记的那个包会安静地脱离锁步，直到某天发版打出一个版本号对不上的 tag。
 */
export function auditFixedGroup(
  packages: WorkspacePackage[] = versionedPackages(),
): FixedGroupAudit {
  const members = readVersioningConfig().fixed.flat()
  const memberSet = new Set(members)
  const seen = new Set<string>()
  const duplicated: string[] = []
  for (const name of members) {
    if (seen.has(name))
      duplicated.push(name)
    seen.add(name)
  }
  const workspace = new Set(packages.map(pkg => pkg.name))
  return {
    missing: packages.map(pkg => pkg.name).filter(name => !memberSet.has(name)).sort(),
    unknown: [...memberSet].filter(name => !workspace.has(name)).sort(),
    duplicated: [...new Set(duplicated)].sort(),
  }
}

/** 提交改动的文件里，是否至少有一个落在某个包目录下（= 是代码改动，不是纯仓库级改动） */
export function isWorkspaceCommit(files: string[]): boolean {
  if (files.length === 0)
    return false
  return files.some((file) => {
    const top = file.split('/')[0]
    return !NON_PACKAGE_TOP_SEGMENTS.includes(top) && !file.startsWith('docs/')
  })
}

export interface AttributionContext {
  /** 目录 → 包名（包含嵌套包；调用方一次构建、多次复用） */
  dirIndex: WorkspacePackage[]
}

export function buildAttributionContext(packages: WorkspacePackage[] = workspacePackages()): AttributionContext {
  return { dirIndex: packages }
}

/**
 * 归属一条提交。返回要写进意图的包名清单（去重、稳定序）；返回 `null` = **不产生意图**。
 *
 * 路径优先用的是「最长前缀」：`packages/tooling/scripts` 会比 `packages/tooling` 先命中
 * （后者不是包目录，所以这条现在只是防御性写法）。
 */
export function attributeCommit(
  parsed: ParsedCommit,
  files: string[],
  context: AttributionContext,
): string[] | null {
  // ① 路径优先
  const byPath = new Set<string>()
  for (const file of files) {
    let best: WorkspacePackage | null = null
    for (const pkg of context.dirIndex) {
      if (!file.startsWith(`${pkg.dir}/`))
        continue
      if (best === null || pkg.dir.length > best.dir.length)
        best = pkg
    }
    if (best)
      byPath.add(best.name)
  }
  if (byPath.size > 0)
    return [...byPath].sort()

  // ② scope 兜底（仅当路径一个包都没命中）
  const scope = parsed.scope
  if (scope === null)
    return null
  if (INFRA_SCOPES.includes(scope))
    return null
  const scoped = SCOPE_TO_PACKAGE[scope]
  return scoped ? [scoped] : null

  // ③ 其余一律不产生意图：未在册的 scope 与「只动仓库级文件」的提交不带动产品版本号。
  //    凡真改了某个包的文件，① 已经命中了 —— 这不是「变更丢失」。
}

/** 诊断用：这条提交被谁挡住了（`--status` 与日志里解释「为什么没有意图」） */
export function describeAttributionSkip(parsed: ParsedCommit, files: string[]): string {
  if (files.length === 0)
    return '空改动'
  if (parsed.scope === null)
    return '无 scope 且改动不在任何包目录下'
  if (INFRA_SCOPES.includes(parsed.scope))
    return `基础设施 scope（${parsed.scope}）`
  if (!SCOPE_TO_PACKAGE[parsed.scope])
    return `未在册的 scope（${parsed.scope}）且改动不在任何包目录下`
  return '无归属'
}

/** 供测试与错误信息使用：包目录清单（不含版本号过滤） */
export function workspaceDirs(packages: WorkspacePackage[] = workspacePackages()): string[] {
  return packages.map(pkg => pkg.dir)
}

/** 当前进程的 cwd 是否就是仓库根（从子目录跑会读错 `.changeset/` 且 `git add .` 只覆盖子树） */
export function isAtRepoRoot(): boolean {
  return path.resolve(process.cwd()) === path.resolve(REPO_ROOT)
}

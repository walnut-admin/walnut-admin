/**
 * 逐包写 `CHANGELOG.md`（git-cliff 渲染）—— 发版链紧接「消费意图」之后的写盘步骤。
 *
 * 两条硬规则（都有真实回退案例背书，改这里之前先读）：
 * ① 段落标题**永远带版本**：`--unreleased --tag vX.Y.Z` ⇒ `## X.Y.Z`，不产生 `## [Unreleased]`
 *    那种可以被叠加的段；
 * ② 写入**幂等**：目标文件里已有该版本段就跳过 —— 断点续跑（中断在「版本已 bump、还没提交」
 *    那一档）会重跑本步骤，不幂等就会写第二段。
 *
 * 渲染与落盘的分工：git-cliff 只渲到 stdout（`--config cliff.toml`），**落盘由本模块做**
 * （拼一级标题 + 前缀新段）。这样每包不同的一级标题（`# @walnut/<包名>`）不需要逐包覆盖
 * git-cliff 的 header 配置，两边也不用猜对方的空白处理。
 *
 * 失败口径：单个包渲染失败 ⇒ 收集起来、最后 `die(1)` **中止整个发版**（此刻 tag 还没打，
 * 停下只是一次重跑；放过去就是「tag 已发、这一版的 changelog 永远补不回来」）。
 * 「本次没有该包的条目」是**正常跳过**，与渲染失败必须分开报。
 *
 * 不做什么：不算版本号、不决定 bump、不提交、不打标、不读 `.changeset/**`。
 */

import type { ReleaseUi } from './ui.ts'
import fs from 'node:fs'
import path from 'node:path'
import { PreconditionError } from '@walnut/scripts/lib/errors'
import { gitRemoteUrl, lsFilesStrict } from '@walnut/scripts/lib/git'
import { REPO_ROOT } from '@walnut/scripts/lib/repo-root'
import { runGitCliff } from 'git-cliff'
import { versionedPackages } from './attribution.ts'
import { parseGithubRemote } from './github.ts'
import { extractChangelogSection } from './plan.ts'

/** 渲染规则（`header`/`footer` 留空，标题由本模块写；见 cliff.toml 的文件头注释） */
export const CLIFF_CONFIG_PATH = path.join(REPO_ROOT, 'cliff.toml')

/** changelog 落点（只服务本文件的两个函数，故不导出） */
interface ChangelogPackage {
  /** 包目录（仓库相对路径） */
  dir: string
  /** 包名 —— 同时是 CHANGELOG 的一级标题去掉 `# ` 之后的内容 */
  name: string
  /** 目标文件（仓库相对路径） */
  file: string
}

/** 有版本号的工作区包（= 该有 changelog 的那些；根包没有 version，故不在内） */
function changelogPackages(): ChangelogPackage[] {
  return versionedPackages().map(pkg => ({
    dir: pkg.dir,
    name: pkg.name,
    file: `${pkg.dir}/CHANGELOG.md`,
  }))
}

/**
 * 「不属于任何包」的路径模式（仓库根相对、给 git-cliff 的 `--include-path`）。
 *
 * 为什么需要：按路径归属时，根级文件（`turbo.json`、`pnpm-lock.yaml`、`deploy/**`、`.github/**`…）
 * 不属于任何包 ⇒ 谁都不会记它们；而本仓的既有口径是「这类改动归主应用」（否则会出现
 * 「发了一版但主页 changelog 是空的」）。这里从 `git ls-files` 现算，不维护手写清单。
 *
 * ⚠️ 两种粒度，别退化成「一律 `<顶层段>/**`」：
 *   - 顶层段里**没有**包目录（`deploy` / `.github` / `cliff.toml` …）⇒ 整段纳入 `<顶层段>/**`；
 *   - 顶层段里**住着**包目录（`apps` → `apps/admin`、`packages` → `packages/tooling/scripts`）
 *     ⇒ 只能精确到**文件本身**（如 `apps/README.md`）。写成 `apps/**` 会把 `apps/server/**`
 *     也扫进来，于是 server 的提交同时出现在 admin 的 changelog 里（跨包重复）。
 */
export function outsidePackagePatterns(packageDirs: string[], trackedFiles: string[]): string[] {
  const dirs = packageDirs.filter(Boolean)
  /** 这个顶层段里是否住着包目录 */
  const holdsPackageDirs = (segment: string): boolean => dirs.some(dir => dir.startsWith(`${segment}/`))
  const patterns = new Set<string>()
  for (const file of trackedFiles) {
    if (dirs.some(dir => file.startsWith(`${dir}/`)))
      continue
    const segment = file.split('/')[0]!
    patterns.add(!file.includes('/') || holdsPackageDirs(segment) ? file : `${segment}/**`)
  }
  return [...patterns].sort()
}

/** 该包的纳入模式：自己的目录，主应用额外带上「包外路径」 */
export function includePathsFor(dir: string, outsidePatterns: string[], mainDir: string): string[] {
  const own = [`${dir}/**`]
  return dir === mainDir ? [...own, ...outsidePatterns] : own
}

/**
 * 该包要**排除**的路径：住得更深的嵌套包。
 *
 * 为什么必须排：`--include-path` 之间是**或**关系，而 `**` 跨目录段 ⇒ `packages/tooling/**`
 * 会把 `packages/tooling/scripts/**` 一起匹配进来，于是子包的提交同时出现在父包与它自己的
 * changelog 里 —— 与意图归属（最长前缀）不一致，是**跨包重复**。
 * `exclude-path` 优先于 `include-path`（git-cliff 文档明写），故这一对参数就是精确的「只认自己」。
 */
export function excludePathsFor(dir: string, allDirs: string[]): string[] {
  return allDirs.filter(other => other !== dir && other.startsWith(`${dir}/`)).map(other => `${other}/**`)
}

/** git-cliff 的公共参数：配置 + 纳入模式 + 排除模式（两种都可重复） */
function commonCliffArgs(includePaths: string[], excludePaths: string[] = []): string[] {
  return [
    '--config',
    CLIFF_CONFIG_PATH,
    ...includePaths.flatMap(pattern => ['--include-path', pattern]),
    ...excludePaths.flatMap(pattern => ['--exclude-path', pattern]),
  ]
}

/** 写 changelog 用的参数：**未打 tag 的提交** + 指定版本号（跑在打 tag 之前） */
export function cliffArgsForChangelog(input: { version: string, includePaths: string[], excludePaths?: string[] }): string[] {
  return ['--unreleased', '--tag', `v${input.version}`, ...commonCliffArgs(input.includePaths, input.excludePaths)]
}

/** Release 正文用的参数：不带 include-path ⇒ 整仓一份，天然无跨包重复 */
export function cliffArgsForReleaseNotes(version: string): string[] {
  return ['--unreleased', '--tag', `v${version}`, '--config', CLIFF_CONFIG_PATH]
}

/**
 * 规范化渲染结果：去掉首尾空白，并把 3 个以上连续换行压成 2 个。
 *
 * 为什么必须做：Tera 对换行敏感（模板里为了拿到「组之间一个空行」必须多留一行），而文件是要
 * 提交进仓库的产物 —— 形状必须由代码钉死，不能取决于模板里数了几个空行。
 */
export function normalizeRendered(rendered: string): string {
  return rendered.trim().replace(/\n{3,}/g, '\n\n')
}

/**
 * 拼出 `一级标题 + 新段 + 旧内容`。
 *
 * 旧内容里的标题要**恰好处理一次**，否则文件会出现两个 H1（git 平台与面板都按第一个 H1 认包名）：
 *   - 与期望 header 逐字相同 ⇒ 剥掉它，由我们重新写出；
 *   - 是**别的一级标题**（包改名 / 历史格式差异）⇒ 用期望标题替换它（不能留两份）；
 *   - 没有一级标题 ⇒ 原样接在后面。
 * 新包首次发版（文件不存在）只写 `标题 + 新段`。
 */
export function composeChangelog(input: { existing: string, header: string, section: string }): string {
  const { existing, header, section } = input
  let body: string
  if (existing.startsWith(header)) {
    body = existing.slice(header.length).replace(/^\n+/, '')
  }
  else {
    const lines = existing.split('\n')
    const foreignH1 = /^#\s/.test(lines[0] ?? '')
    body = (foreignH1 ? lines.slice(1).join('\n') : existing).replace(/^\n+/, '')
  }
  const head = `${header}\n\n${section}\n`
  return body.trim() === '' ? `${head}` : `${head}\n${body.replace(/\n+$/, '')}\n`
}

/** 文件里是否已有该版本段（幂等判据：与发版链抽段用的是同一个函数，避免两处口径漂移） */
export function hasVersionSection(markdown: string, version: string): boolean {
  return extractChangelogSection(markdown, version) !== null
}

/** 一段渲染结果里有没有条目（只有标题 / 空段 ⇒ 这次该包没有内容） */
export function hasEntries(section: string): boolean {
  return /^- /m.test(section)
}

/**
 * cliff.toml 里写死的那份仓库地址，必须与 `git remote get-url origin` 一致。
 *
 * 为什么必须断言：模板里的 commit / PR 链接是**字面量**（`commit.remote` 只在 API 返回过该
 * commit 时才存在，不是 URL 的来源）。仓库改名 / 换 remote 之后不报错的话，写进仓库与 Release
 * 的链接会**全部 404**，而且是静默的。
 */
export function assertCliffRemoteMatches(): void {
  const remote = gitRemoteUrl()
  if (!remote)
    return
  const repo = parseGithubRemote(remote)
  if (!repo)
    return
  let config: string
  try {
    config = fs.readFileSync(CLIFF_CONFIG_PATH, 'utf8')
  }
  catch (error: any) {
    throw new PreconditionError(`读不到 ${CLIFF_CONFIG_PATH}：${error?.message ?? error}`)
  }
  const expectedUrl = `https://github.com/${repo.owner}/${repo.repo}`
  if (!config.includes(expectedUrl)) {
    throw new PreconditionError(
      `cliff.toml 里的仓库地址与 git remote 不一致（远程是 ${expectedUrl}）—— commit 链接会全部 404。`
      + '模板里的链接是字面量（git-cliff 的 remote 只提供 PR 号/作者，不提供 URL），先改 cliff.toml 再发版',
    )
  }
}

/** 跑 git-cliff 并取回 stdout（走官方编程 API：它自己解析平台二进制，不经 PATH / `.cmd` shim） */
async function renderCliff(args: string[]): Promise<string> {
  // `cwd: REPO_ROOT` 不能省：git-cliff 以 cwd 找仓库与配置，从子目录跑会读到别的树
  const result = await runGitCliff(args, { stdio: 'pipe', cwd: REPO_ROOT })
  const stdout = typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? '')
  return normalizeRendered(stdout)
}

/**
 * 渲染「本次发版」的整仓段落（给 `changelog-latest.md` / GitHub Release 正文用）。
 *
 * ⚠️ `expectedVersion` 是**必须**的：渲染跑在打 tag 之前，用 `--unreleased --tag vX.Y.Z`，
 * 而标题里的版本必须与本次要发的一致 —— 对不上就返回 null，由调用方退回意图摘要。
 */
export async function renderReleaseNotes(expectedVersion: string): Promise<string | null> {
  try {
    const section = await renderCliff(cliffArgsForReleaseNotes(expectedVersion))
    if (!hasEntries(section) || !hasVersionSection(section, expectedVersion))
      return null
    return section
  }
  catch {
    return null
  }
}

export interface ChangelogOutcome {
  dir: string
  file: string
  action: 'written' | 'skipped'
  detail: string
}

/**
 * 逐包写 changelog。`dryRun` 只渲染不落盘（并把预览打出来）。
 *
 * 失败口径（**渲染失败一律 die(1)，不降级**）：这一步跑在提交/打 tag **之前**，此刻停下只是
 * 重跑一次；而放过去就是「tag 已发、这一版的 changelog 永远补不回来」。
 */
export async function ensureChangelogs(ui: ReleaseUi, input: { version: string, dryRun?: boolean }): Promise<ChangelogOutcome[]> {
  const { version, dryRun = false } = input
  const packages = changelogPackages()
  if (packages.length === 0) {
    ui.warn('没发现任何带版本号的 workspace 包 —— 跳过 changelog（这本身可疑，检查 pnpm-workspace.yaml 的 packages）')
    return []
  }

  assertCliffRemoteMatches()

  const dirs = packages.map(pkg => pkg.dir)
  const outside = outsidePackagePatterns(dirs, lsFilesStrict('*'))
  // 主应用是「包外改动」的落点，从配置读而不是再写一个字面量
  const mainDir = 'apps/admin'

  const outcomes: ChangelogOutcome[] = []
  const failures: string[] = []
  let preview: { file: string, section: string } | null = null

  for (const pkg of packages) {
    const absolute = path.join(REPO_ROOT, pkg.file)
    const existing = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : ''
    // 幂等判据在演练里同样生效：否则演练报的「将写入 N 份」与真跑不一致
    if (hasVersionSection(existing, version)) {
      outcomes.push({ dir: pkg.dir, file: pkg.file, action: 'skipped', detail: `已有 ${version} 段（幂等跳过）` })
      continue
    }

    let section: string
    try {
      section = await renderCliff(cliffArgsForChangelog({
        version,
        includePaths: includePathsFor(pkg.dir, outside, mainDir),
        excludePaths: excludePathsFor(pkg.dir, dirs),
      }))
    }
    catch (error: any) {
      const why = String(error?.stderr ?? error?.message ?? error).trim().split('\n')[0] ?? '未知错误'
      failures.push(`${pkg.file}（${why}）`)
      outcomes.push({ dir: pkg.dir, file: pkg.file, action: 'skipped', detail: `渲染失败：${why}` })
      continue
    }

    if (!hasEntries(section)) {
      outcomes.push({ dir: pkg.dir, file: pkg.file, action: 'skipped', detail: '本次没有该包的条目' })
      continue
    }

    preview ??= { file: pkg.file, section }
    const count = section.split('\n').filter(line => line.startsWith('- ')).length
    if (dryRun) {
      outcomes.push({ dir: pkg.dir, file: pkg.file, action: 'written', detail: `将写入（${count} 条）` })
      continue
    }
    fs.writeFileSync(absolute, composeChangelog({ existing, header: `# ${pkg.name}`, section }))
    outcomes.push({ dir: pkg.dir, file: pkg.file, action: 'written', detail: `${count} 条` })
  }

  const written = outcomes.filter(item => item.action === 'written')
  const skipped = outcomes.filter(item => item.action === 'skipped')
  ui.log(`${dryRun ? '（演练）' : ''}changelog：${written.length} 份${dryRun ? '将写入' : '已写入'}，${skipped.length} 份跳过`)
  for (const item of skipped)
    ui.log(`   · 跳过 ${item.file}：${item.detail}`)

  if (dryRun && preview) {
    ui.banner([
      `  🧪 --dry-run：changelog 预览（${preview.file}）`,
      '',
      ...preview.section.split('\n').slice(0, 20).map(line => `   ${line}`),
    ])
  }

  if (failures.length > 0) {
    ui.die(1, `changelog 渲染失败 ${failures.length} 个包${dryRun ? '（--dry-run：未写盘）' : ''} —— 拒绝继续（tag 还没打）：`
    + `\n   · ${failures.join('\n   · ')}`
    + '\n   常见原因：`pnpm install` 没装全（git-cliff 的平台二进制在 optionalDependencies 里）、cliff.toml 被改坏、GitHub API 不可达（加 GITHUB_TOKEN 或稍后重试）。修好后重跑。')
  }

  return outcomes
}

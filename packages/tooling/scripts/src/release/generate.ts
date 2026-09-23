/**
 * 第 1–2 步：从 commit 生成变更意图（`pnpm change`）+ 升级级别确认。
 *
 * 为什么意图由 `pnpm change` 写而不是自己 `fs.writeFileSync`：pnpm 原生 release management 的
 * 意图文件与 `ledger.yaml` 是一套账 —— 自己写文件会让台账与实际意图对不上（`pnpm version -r`
 * 消费时按文件记账，而「消费过没有」的判据正是台账）。走官方入口，账就是一致的。
 *
 * 归属与 bump 的判据分别在 attribution.ts 与 commit-intent.ts；本模块只做编排与「写完必须验落盘」。
 */

import type { ReleaseArgs } from './args.ts'
import type { Bump, Intent } from './intents.ts'
import type { ReleaseUi } from './ui.ts'
import fs from 'node:fs'
import path from 'node:path'
import { PreconditionError } from '../lib/errors.ts'
import { commitFiles, commitsSince } from '../lib/git.ts'
import { attributeCommit, auditFixedGroup, buildAttributionContext, describeAttributionSkip, workspacePackages } from './attribution.ts'
import { bumpLabel, overrideIntentBump, resolveAutoBump } from './bump.ts'
import { buildIntentSummary, getBump, hashesInIntentBodies, parseCommit } from './commit-intent.ts'
import { bumpPriority, isBump, nextVersion } from './intents.ts'
import { CHANGESET_DIR, intentFilesOnDisk, readIntents } from './workspace.ts'

export interface GenerateOutcome {
  /** 本次新生成的意图个数 */
  generated: number
  /** 生成后盘上的全部意图文件名 */
  files: string[]
  /** 自动检测到的最高档（`--dry-run` 用它给出目标版本） */
  wouldBump: Bump
  /** 被过滤掉的提交数（噪声 / 无归属 / skip 类） */
  filtered: number
  /** 因「已生成过」跳过的提交数 */
  skippedExisting: number
}

/**
 * 机械审计 `versioning.fixed` 与 workspace 的一致性。
 *
 * 为什么在生成意图之前：fixed 组漏登记一个包 ⇒ 那个包安静地脱离锁步，直到某天发版打出一个
 * 版本号对不上的 tag。`pnpm change check` 只校验「组内已登记的包是否锁步」，查不出漏登记。
 */
export function auditWorkspaces(ui: ReleaseUi): void {
  const audit = auditFixedGroup()
  if (audit.duplicated.length > 0)
    ui.die(1, `pnpm-workspace.yaml 的 versioning.fixed 里有重复包名：${audit.duplicated.join(', ')}`)
  if (audit.missing.length > 0 || audit.unknown.length > 0) {
    const lines: string[] = []
    if (audit.missing.length > 0)
      lines.push(`   有版本号但不在 fixed 组里（漏登记，会安静地脱离锁步）：${audit.missing.join(', ')}`)
    if (audit.unknown.length > 0)
      lines.push(`   在 fixed 组里但工作区不存在（改了包名/删了包没同步）：${audit.unknown.join(', ')}`)
    ui.die(1, `versioning.fixed 与实际 workspace 不一致：\n${lines.join('\n')}\n   修 pnpm-workspace.yaml 的 versioning.fixed 后重跑。`)
  }
}

/** 盘上已有的意图正文（用于「这条 commit 生成过没有」的幂等判据） */
function existingIntentBodies(): string[] {
  const bodies: string[] = []
  for (const file of intentFilesOnDisk()) {
    try {
      bodies.push(fs.readFileSync(path.join(CHANGESET_DIR, file), 'utf8'))
    }
    catch {
      continue
    }
  }
  return bodies
}

export interface GenerateInput {
  /** 只演练：不写盘、不调 `pnpm change`，只统计会产生什么 */
  dryRun: boolean
  /** 上次 tag（null = 首次发版，扫描全部 commit） */
  baseTag: string | null
}

export async function generateIntents(ui: ReleaseUi, input: GenerateInput): Promise<GenerateOutcome> {
  auditWorkspaces(ui)

  const packages = workspacePackages()
  const context = buildAttributionContext(packages)
  const commits = commitsSince(input.baseTag)
  ui.log(input.baseTag
    ? `扫描 ${input.baseTag}..HEAD 的 ${commits.length} 个提交`
    : `没有历史 tag —— 扫描全部 ${commits.length} 个提交（首次发版）`)

  const alreadyWritten = hashesInIntentBodies(existingIntentBodies())
  const filteredReasons = new Map<string, number>()
  const bumpsSeen: Bump[] = []
  let generated = 0
  let skippedExisting = 0
  let filtered = 0

  const countFilter = (reason: string) => {
    filtered++
    filteredReasons.set(reason, (filteredReasons.get(reason) ?? 0) + 1)
  }

  for (const commit of commits) {
    const parsed = parseCommit(commit.hash, commit.subject)
    if (!parsed) {
      countFilter('噪声提交')
      continue
    }

    const diffBump = getBump(parsed)
    if (diffBump === 'skip') {
      countFilter(`${parsed.type} 类（不触发发版）`)
      continue
    }

    if (alreadyWritten.has(parsed.hash)) {
      skippedExisting++
      continue
    }

    const files = commitFiles(parsed.hash)
    if (files.length === 0) {
      countFilter('读不到改动文件')
      continue
    }

    const targets = attributeCommit(parsed, files, context)
    if (targets === null || targets.length === 0) {
      countFilter(describeAttributionSkip(parsed, files))
      continue
    }

    const summary = buildIntentSummary(parsed)
    // 只收 major/minor/patch（`skip` 已在上面分流出去了）
    if (diffBump === 'major' || diffBump === 'minor' || diffBump === 'patch')
      bumpsSeen.push(diffBump)

    if (input.dryRun) {
      // 演练：零写盘（连 `pnpm change` 都不调）
      ui.log(`   将生成 [${diffBump}] ${summary}  → ${targets.join(', ')}`)
      generated++
      continue
    }

    const result = ui.execPnpmSync(['change', '--bump', diffBump, '--summary', summary, ...targets])
    if (result.code !== 0) {
      throw new PreconditionError(
        `pnpm change 失败（exit ${result.code}）—— 意图未写入。\n`
        + `   命令：pnpm change --bump ${diffBump} --summary <正文> ${targets.join(' ')}\n`
        + `   ${(result.stderr || result.stdout).trim().split('\n').slice(-5).join('\n   ')}`,
      )
    }

    // ⚠️ 必须验「文件真的落盘且含该 hash」：`pnpm change` 可能因 corepack 提示 / 网络静默不动，
    // 把「尝试写入」误报成「已生成」会让后续的 ledger 对账全错。
    if (!intentFileContainsHash(parsed.hash)) {
      throw new PreconditionError(
        `pnpm change 报成功，但盘上找不到含 ${parsed.hash} 的意图文件 —— 拒绝继续（不能让「尝试写入」被当成「已生成」）。`
        + '常见原因：corepack 首次运行提示、pnpm 版本不符。先单独跑一次 `pnpm change --help` 确认可用。',
      )
    }

    generated++
  }

  const files = intentFilesOnDisk().sort()

  /**
   * 自动检测档位 = **本次扫描到的档位** 与 **盘上已有意图的档位** 取最高。
   *
   * ⚠️ 不能只看盘上：`--dry-run` 不写盘 ⇒ `readIntents()` 永远只剩旧意图，于是
   * 「扫出一堆 feat、却报 patch」这种自相矛盾的演练结果（实测踩到，v0.0.2 而列表里全是 minor）。
   * 也不能只看扫描：断点续跑时部分意图已落盘、本次被 `skippedExisting` 跳过，它们的档位不在
   * `bumpsSeen` 里。两个来源取最高才对两边都成立。
   */
  const wouldBump = higherBump(resolveAutoBump(readIntents()), highestOf(bumpsSeen))

  ui.log(`生成 ${generated} 个意图，跳过 ${skippedExisting} 个（已存在），过滤 ${filtered} 个（噪声/无归属/不触发发版）`)
  for (const [reason, count] of [...filteredReasons.entries()].sort((a, b) => b[1] - a[1]))
    ui.log(`   · 过滤 ${count} 个：${reason}`)

  return { generated, files, wouldBump, filtered, skippedExisting }
}

/** 一组档位里的最高值（空集 = `none`） */
function highestOf(bumps: Bump[]): Bump {
  let best: Bump = 'none'
  for (const bump of bumps) {
    if (bumpPriority(bump) > bumpPriority(best))
      best = bump
  }
  return best
}

/** 两个档位取最高 */
function higherBump(a: Bump, b: Bump): Bump {
  return bumpPriority(a) >= bumpPriority(b) ? a : b
}

/** 盘上是否存在含该 hash 的意图文件 */
function intentFileContainsHash(hash: string): boolean {
  for (const file of intentFilesOnDisk()) {
    try {
      if (fs.readFileSync(path.join(CHANGESET_DIR, file), 'utf8').includes(hash))
        return true
    }
    catch {
      continue
    }
  }
  return false
}

/** 计算目标版本；算不出来就 die（不猜） */
export function nextVersionOrDie(ui: ReleaseUi, version: string, bump: Bump): string {
  const next = nextVersion(version, bump)
  if (next === null) {
    ui.die(2, `算不出 v${version} 在 ${bump} 档下的下一个版本号 —— 它可能带了 prerelease / build 元数据。`
    + '本仓不用 lane，出现这种版本号说明有人手工改过 manifest，请先对齐版本号再发版。')
  }
  return next
}

/**
 * 第 2 步：确认升级级别。
 *
 * 交互只在「是 TTY 且没给 `--bump`」时发生；非交互缺 `--bump` 一律 exit 2 —— **不猜**。
 * `--dry-run` 是例外：它不写盘也不交互，缺 `--bump` 时采用自动检测值并打印预览
 * （演练的价值就是「不给参数先看一眼」）。
 */
export async function resolveBump(
  ui: ReleaseUi,
  args: ReleaseArgs,
  entries: Intent[],
  oldVersion: string,
  dryRun: boolean,
): Promise<Bump> {
  const autoBump = resolveAutoBump(entries)

  if (entries.length === 0) {
    ui.log('没有待消费的意图 —— 无可发版内容')
    return 'none'
  }

  // emoji 标记
  const bumpEmoji: Record<string, string> = { major: '💥', minor: '✨', patch: '🐛', none: '⏭️' }
  const emoji = (bump: string) => bumpEmoji[bump] ?? '🔧'

  ui.log(`待发布的意图 ${entries.length} 个：`)
  for (const entry of entries) {
    const line = entry.summary.split('\n')[0] ?? ''
    ui.log(`    ${emoji(entry.bump)} [${entry.bump}] ${line.length > 84 ? `${line.slice(0, 84)}…` : line}`)
  }

  const expected = autoBump === 'none' ? oldVersion : (nextVersion(oldVersion, autoBump) ?? '?')
  ui.log(`检测到版本升级：${bumpLabel(autoBump)}  (v${oldVersion} -> v${expected})`)

  if (args.bump) {
    if (args.bump !== autoBump)
      ui.log(`--bump 覆盖自动检测档位：${autoBump} → ${args.bump}`)
    applyBumpOverride(ui, entries, args.bump, dryRun)
    return args.bump
  }

  if (dryRun) {
    ui.log(`--dry-run：未给 --bump，采用自动检测值 ${autoBump}`)
    return autoBump
  }

  if (!ui.isInteractive()) {
    ui.die(2, '非交互环境必须显式给 --bump major|minor|patch（本次尚未改动任何文件）。'
    + '只想看计划用 --plan；想零写盘演练用 --dry-run。')
  }

  const answer = (await ui.ask(`  确认版本升级类型? [回车=${autoBump} / 输入 major|minor|patch 覆盖]: `)).trim().toLowerCase()
  if (answer === '') {
    ui.log(`使用自动检测的 bump 类型：${autoBump}`)
    return autoBump
  }
  if (answer === 'major' || answer === 'minor' || answer === 'patch') {
    if (answer !== autoBump) {
      ui.log(`覆盖 bump 类型：${autoBump} → ${answer}`)
      applyBumpOverride(ui, entries, answer, dryRun)
    }
    return answer
  }

  ui.warn(`无效输入 '${answer}'，使用自动检测：${autoBump}`)
  return autoBump
}

/**
 * 把选定的档位写回**所有**意图文件的 frontmatter。
 *
 * ⚠️ 为什么必须逐个改而不是只改一个：`pnpm version -r` 取的是「组内最大 bump」，
 * 漏改任何一条都会让另一个更高的档位重新胜出 —— 用户的选择就会静默失效。
 */
function applyBumpOverride(ui: ReleaseUi, entries: Intent[], bump: Bump, dryRun: boolean): void {
  if (dryRun) {
    ui.log(`（演练）将把 ${entries.length} 个意图的 frontmatter 改写为 ${bump}`)
    return
  }
  if (!isBump(bump))
    return
  let changedFiles = 0
  let changedLines = 0
  for (const entry of entries) {
    const filePath = path.join(CHANGESET_DIR, entry.file)
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf8')
    }
    catch {
      continue
    }
    const result = overrideIntentBump(content, bump)
    if (result.changed === 0)
      continue
    fs.writeFileSync(filePath, result.content)
    changedFiles++
    changedLines += result.changed
  }
  ui.log(`已改写 ${changedFiles} 个意图文件的 frontmatter（共 ${changedLines} 行）`)
}

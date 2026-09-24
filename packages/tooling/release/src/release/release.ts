#!/usr/bin/env node
/**
 * 发版唯一入口：生成意图 → 确认 bump → 消费意图 → changelog → 总览确认 → 提交/门禁/打标/推送。
 *
 * 为什么需要：发版是多步且**不可逆**的（消费意图 / 打 tag / push），任何一步失败或 Ctrl+C 之后
 * 重跑都必须从断点接上 —— 判据只来自可观测事实（见本目录 plan / facts / workspace），不靠本机记忆。
 *
 * 失败口径：0 完成（含「无需发版」）/ 1 检出不一致或子步骤失败 / 2 前置条件未满足
 * （分支、工作区、缺 flag）；细表见 args.ts 的 USAGE。
 *
 * 不做什么：不决定版本号（意图 + `pnpm version -r` 决定）、不建 GitHub Release（那是
 * `.github/workflows/release.yml` 的职责）、不改 workflow 文件。
 */

import type { ReleaseArgs } from './args.ts'
import type { CollectedFacts } from './facts.ts'
import type { Bump, Intent } from './intents.ts'
import type { ReleaseStep } from './plan.ts'
import type { ReleaseState } from './state.ts'
import type { ReleaseUi } from './ui.ts'
import process from 'node:process'
import { ChildRunError, runArgs, runSync, streamOutput } from '@walnut/scripts/lib/child-run'
import { KILL_GRACE_MS, killActiveChild, waitForActiveChildExit } from '@walnut/scripts/lib/child-tree'
import { PreconditionError } from '@walnut/scripts/lib/errors'
import { branchBehind, currentBranch, gitRemoteUrl, trackedDirtyFiles } from '@walnut/scripts/lib/git'
import { frame, writeOut } from '@walnut/scripts/lib/log'
import { getPnpmBin } from '@walnut/scripts/lib/pnpm-launcher'
import { askSecret, isInteractive, question } from '@walnut/scripts/lib/prompt'
import { REPO_ROOT } from '@walnut/scripts/lib/repo-root'

import { parseReleaseArgs, skipGatesLabel, USAGE } from './args.ts'
import { bumpChangesVersion, bumpLabel } from './bump.ts'
import { ensureChangelogs } from './changelog.ts'
import { consumeIntents } from './consume.ts'
import { resolveToken } from './credentials.ts'
import { RELEASE_CHILD_ENV } from './env.ts'
import { collateFacts, collectUnrelatedChanges, makeReleaseProbe } from './facts.ts'
import { generateIntents, nextVersionOrDie, resolveBump } from './generate.ts'
import { maskToken } from './github.ts'
import { writeReleaseNotes } from './notes.ts'
import { describeStep, isBumped, planRelease } from './plan.ts'
import { abortHintLines, dryRunGenerateLines, statusLines } from './report.ts'
import { clearState, readState, setStateDryRun, writeState } from './state.ts'
import { confirmSummary, releaseBatteryCount, releaseBatterySkippedCount, stepCommitTagPush } from './steps.ts'
import { currentVersion, deleteConsumedIntents, intentsOfVersion, readIntents, unconsumedIntents } from './workspace.ts'

// ── 常量与输出 ────────────────────────────────────────────────────────────

let ARGS: ReleaseArgs

/**
 * 人类日志：`--json` 时全部走 stderr，stdout 只留给机器可读结果。
 * 底层（TTY vs 管道的写入路径、Windows 代码页问题）在 lib/log.ts 的 writeOut 里。
 */
function log(msg: string): void {
  writeOut(`\x1B[36m[release]\x1B[0m ${msg}\n`, Boolean(ARGS?.json))
}

function warn(msg: string): void {
  log(`⚠️  ${msg}`)
}

/** 交互横幅（总览 / 状态用；`--json` 时也走 stderr） */
function banner(lines: string[]): void {
  writeOut(frame(lines), Boolean(ARGS?.json))
}

function emitJson(payload: Record<string, unknown>): void {
  if (ARGS?.json)
    writeOut(`${JSON.stringify(payload, null, 2)}\n`, false)
}

function die(code: 1 | 2, msg: string): never {
  log(`❌ ${msg}`)
  emitJson({ ok: false, exitCode: code, error: msg })
  process.exit(code)
}

// ── 子进程 ────────────────────────────────────────────────────────────────

let cachedOutput: ReturnType<typeof streamOutput> | null = null
function childOutput(): ReturnType<typeof streamOutput> {
  if (!cachedOutput)
    cachedOutput = streamOutput(Boolean(ARGS?.json))
  return cachedOutput
}

/**
 * 跑子进程的**统一出口**：日志出口 + 输出改道 + 剥过凭据的环境，一次给全。
 *
 * 为什么要有它：凭据剥离（`RELEASE_CHILD_ENV`）是「每个子进程都必须带」的性质，靠每个调用点
 * 自己写 `env` 迟早漏一个 —— 而漏掉的那个可能是 `git push`（它会触发仓内脚本，那些脚本读得到 token）。
 * 收进一个工厂函数后，「有没有剥凭据」不再是每个调用点的选择。
 */
function childOptions(extra: Record<string, unknown> = {}): any {
  return {
    note: log,
    output: childOutput(),
    env: RELEASE_CHILD_ENV,
    cwd: REPO_ROOT,
    budgetEnv: 'RELEASE_CMD_TIMEOUT_MS',
    ...extra,
  }
}

/** 步骤模块与 CLI 之间的接口：**实现都在本文件**（日志 / 交互 / 退出策略 / 子进程出口） */
const ui: ReleaseUi = {
  log,
  warn,
  banner,
  emitJson,
  die,
  childOptions,
  runPnpmStep: async (args, hint) => {
    await runArgs(getPnpmBin(), args, childOptions({ hint }))
  },
  execPnpmSync: (args) => {
    // 同步执行秒级命令（`pnpm change` 每个 commit 一次）：走同一个出口 ⇒ 同样剥凭据、同样 argv 直传
    const result = runSync(getPnpmBin(), args, { cwd: REPO_ROOT, env: RELEASE_CHILD_ENV })
    return { code: result.code, stdout: result.stdout, stderr: result.stderr }
  },
  isInteractive,
  ask: question,
  askSecret,
}

// ── 事实采集 ──────────────────────────────────────────────────────────────

/**
 * **本次运行**的时序状态：开跑前记一份工作区基线，「无关改动」只报基线之外新出现的。
 *
 * 为什么需要基线：这个判定原本只在「消费完成之后」做一次，于是消费期间任何别的进程
 * （编辑器、watch、并发 install）碰过的文件都会被算成「无关改动」而拦人。改成基线之后，
 * 结论与「期间谁碰过工作区」无关。
 */
let dirtyBaseline: Set<string> | null = null

function snapshotDirtyBaseline(): void {
  dirtyBaseline = new Set(trackedDirtyFiles())
}

/** 本次运行**期间新出现**的无关改动 —— 拦截只看它（基线里就有的不拦） */
function newlyUnrelatedChanges(): string[] {
  return collectUnrelatedChanges().filter(file => !dirtyBaseline?.has(file))
}

function collectFacts(args: ReleaseArgs, token: string | null): Promise<CollectedFacts> {
  const state = readState()
  return collateFacts({
    stateStep: state?.nextStep ?? null,
    probeRemoteRelease: makeReleaseProbe(token),
  })
}

/** 写状态（写前日志）：失败不影响正确性，只影响下一次的提示 */
function saveState(input: {
  fromVersion: string
  toVersion: string
  bump: Bump
  nextStep: ReleaseStep
  baseTag: string | null
  branch: string
}): void {
  writeState({
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    bump: input.bump,
    nextStep: input.nextStep,
    baseTag: input.baseTag,
    branch: input.branch,
    gatesSkipped: skipGatesLabel(ARGS.skipGates) || null,
  })
}

// ── 状态查询：--status / --plan ───────────────────────────────────────────

function reportStatus(facts: CollectedFacts, plan: { step: ReleaseStep, reason: string, tag: string }, state: ReleaseState | null, planOnly: boolean): void {
  banner(statusLines({
    planOnly,
    currentVersion: facts.currentVersion,
    baseTag: facts.baseTag,
    baseVersion: facts.baseVersion,
    branch: facts.branch,
    branchPushed: facts.branchPushed,
    pendingIntents: facts.pendingIntents,
    versionConsumed: facts.versionConsumed,
    localTagExists: facts.localTagExists,
    remoteTagExists: facts.remoteTagExists,
    remoteReleaseExists: facts.remoteReleaseExists,
    releaseChecked: facts.releaseChecked,
    tag: plan.tag,
    step: plan.step,
    stepText: describeStep(plan.step),
    reason: plan.reason,
    unrelated: facts.unrelated,
    groupMisaligned: facts.groupMisaligned,
    state,
  }))
  emitJson({
    ok: true,
    mode: planOnly ? 'plan' : 'status',
    version: facts.currentVersion,
    baseTag: facts.baseTag,
    branch: facts.branch,
    pendingIntents: facts.pendingIntents,
    versionConsumed: facts.versionConsumed,
    localTagExists: facts.localTagExists,
    remoteTagExists: facts.remoteTagExists,
    remoteReleaseExists: facts.remoteReleaseExists,
    releaseChecked: facts.releaseChecked,
    branchPushed: facts.branchPushed,
    unrelatedChanges: facts.unrelated.length,
    groupMisaligned: facts.groupMisaligned.length,
    nextStep: plan.step,
    nextStepText: describeStep(plan.step),
    reason: plan.reason,
    state,
  })
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function mainRelease(args: ReleaseArgs): Promise<void> {
  const branch = currentBranch()
  if (branch !== 'main')
    die(2, `只能在 main 分支执行发版，当前分支: ${branch}`)

  // 记「开跑前工作区长什么样」：后面判定「无关改动」只认基线之外新冒出来的
  snapshotDirtyBaseline()

  // 0. 凭据：**只用于 git-cliff 补 PR 号/作者**（只读公开仓），不建 Release、不落盘
  const { token, source } = resolveToken(args)
  const writesAnything = !args.intentOnly && !args.status && !args.plan && !args.dryRun
  if (writesAnything) {
    if (token) {
      log(`GitHub token: ${maskToken(token)}（来自 ${source}）—— 仅用于 git-cliff 补 PR 号与作者`)
    }
    else if (args.requireGithubMeta) {
      die(2, '给了 --require-github-meta 但没有 GITHUB_TOKEN：无法补 PR 号/作者，按你的要求中止。'
      + '给法：① 环境变量 GITHUB_TOKEN=<token> ② --token <值>。去掉该 flag 就用降级渲染（只有 commit 链接）。')
    }
    else {
      warn('未提供 GITHUB_TOKEN：changelog 里只有 commit 链接，没有 PR 号/作者。'
        + 'export GITHUB_TOKEN=<token> 可补齐（公开仓匿名也能查，但限流 60 次/小时）。')
    }
  }

  let facts = await collectFacts(args, token)
  let plan = planRelease(facts)

  if (args.status || args.plan) {
    // 只读面**不退出**：半升级也要能在 --status / --plan 里看见（否则用户看不出为什么发不出去）
    reportStatus(facts, plan, readState(), args.plan)
    return
  }

  /**
   * 前置条件：本地分支**不得落后上游**。
   *
   * 为什么必须前置拦：最后那条 push 推两条 ref（分支 + tag）。即使加了 `--atomic`，让远端分支
   * 已经前进却还要发版，本身就是「基于过时代码打了一个版本号」—— 那比 push 失败更难收拾。
   */
  const behind = branchBehind(branch)
  if (behind > 0) {
    die(2, `本地 ${branch} 落后上游 ${behind} 个提交：先 git pull 再发版。
   为什么不能「发完再补」：你想发布的版本应该包含远端的改动，而不是在一个过时的基线上打 tag。`)
  }

  /**
   * 前置条件：工作区必须是**可发版状态**（fixed 组全组同版本）。
   *
   * 为什么必须在写路径的最前面判：消费意图是「逐个改写 manifest」的写盘序列，Ctrl+C / 超时可能停在
   * 只写了一半的地方 —— 那时 apps/admin 可能恰好已是新版本，而别的包还在旧版本。
   */
  if (facts.groupMisaligned.length > 0) {
    log('❌ 工作区不是可发版状态：fixed 组没对齐到同一个版本')
    for (const pkg of facts.groupMisaligned.slice(0, 20))
      log(`   · 不在 v${facts.currentVersion}：${pkg}`)
    if (facts.groupMisaligned.length > 20)
      log(`   · … 另有 ${facts.groupMisaligned.length - 20} 个`)
    die(2, `这是上次「消费意图」被中断留下的半升级状态（共 ${facts.groupMisaligned.length} 个包未对齐）。
   修法：git checkout -- . 把改动全部还原，重跑 pnpm release（意图会按需重新生成）。`)
  }

  /**
   * 前置条件：**已 bump 的版本上不许再有未消费意图**。
   *
   * 两者同时在，说明上次消费只删了一半意图（或有人手写了新意图）。此时按「确认 bump」走会在
   * 已经 bump 过的版本上**再 bump 一档**（打出一个错版本号的 tag）。脚本刻意不自行判断该删还是
   * 该重来 —— 让人看一眼比猜一次便宜。
   */
  if (isBumped(facts) && facts.pendingIntents > 0) {
    die(2, `工作区版本已从 v${facts.baseVersion} 变成 v${facts.currentVersion}，但还剩 ${facts.pendingIntents} 个未消费意图。
   处置：① 这些意图已随 v${facts.currentVersion} 消费（只是文件没删干净）⇒ 删掉它们后重跑；
        ② 想重新来过 ⇒ git checkout -- . 回到基线后重跑。
   刻意不自动选：在已 bump 的版本上再 bump 一档会打出一个错版本号的 tag。`)
  }

  // 阶梯说「已完成」：不提交、不打标、不推送，只报告
  if (plan.step === 'done') {
    reportStatus(facts, plan, readState(), false)
    log(`无需发版：${plan.reason}`)
    emitJson({ ok: true, mode: 'release', released: false, version: facts.currentVersion, tag: plan.tag, reason: plan.reason })
    return
  }

  /**
   * 交互前提**在任何写操作之前**一次性判掉。
   *
   * 为什么不能留给各交互点自己判：`--yes` 若在总览那一步才判，那一步跑在 `pnpm version -r`
   * （= 会改写所有包的 manifest）**之后** —— 非交互缺 flag 属**用法问题**，必须挡在动仓库之前。
   * 只读入口（`--status` / `--plan` / `--intent-only` / `--dry-run`）不在此列：它们本来就不写盘。
   */
  if (!args.intentOnly && !args.dryRun && !isInteractive()) {
    const missing: string[] = []
    if (!args.yes)
      missing.push('--yes（确认总览后继续）')
    if (!args.bump)
      missing.push('--bump major|minor|patch（选定升级级别）')
    if (missing.length > 0) {
      die(2, `非交互环境缺少必需参数：${missing.join('、')}
   本次尚未改动任何文件；补上参数重跑即可。只想看计划用 --plan，想零写盘演练用 --dry-run。`)
    }
  }

  // ── 1. 生成意图 ─────────────────────────────────────────────────────────
  if (args.intentOnly || plan.step === 'generate-intents') {
    if (!args.intentOnly && !args.dryRun && plan.step === 'generate-intents' && readState())
      clearState() // 新一轮开始：上个版本留下的写前日志不得并进本次状态

    log('从上次 tag 以来的 commit 生成变更意图...')
    const outcome = await generateIntents(ui, { dryRun: args.dryRun, baseTag: facts.baseTag })

    if (args.intentOnly) {
      log(`--intent-only：完成（生成 ${outcome.generated} 个，共 ${outcome.files.length} 个待消费意图）`)
      emitJson({ ok: true, mode: 'intent-only', generated: outcome.generated, files: outcome.files })
      return
    }

    if (outcome.files.length === 0) {
      // ⚠️ `--dry-run` 下 `files` **恒为空**（那正是「不写盘」的定义），所以这里绝不能说「无需发版」——
      // 上面一行刚打印过「生成 N 个意图」，两句并列会让一次演练被读成「没有可发布的东西」。
      if (args.dryRun && outcome.generated > 0) {
        const planned = args.bump ?? (outcome.wouldBump === 'none' ? 'patch' : outcome.wouldBump)
        const target = nextVersionOrDie(ui, facts.currentVersion, planned)
        // 演练也要看得见 changelog 与 Release 正文会写成什么样：只渲染、不落盘。
        // 顺带把 git-cliff 这条链在真正发版之前验一遍（配置坏 / 二进制缺在这里就能发现）。
        log('（演练）渲染 changelog 与 Release 正文预览...')
        await ensureChangelogs(ui, { version: target, dryRun: true })
        await writeReleaseNotes(ui, { version: target, summaries: [], dryRun: true })
        banner(dryRunGenerateLines({
          generated: outcome.generated,
          target,
          bump: planned,
          bumpOverridden: Boolean(args.bump),
          batteryCount: releaseBatteryCount(),
        }))
        emitJson({
          ok: true,
          mode: 'release',
          dryRun: true,
          fromVersion: facts.currentVersion,
          toVersion: target,
          bump: planned,
          wouldGenerate: outcome.generated,
          released: false,
        })
        return
      }
      log('没有可生成的变更记录，无需发版')
      if (!args.dryRun)
        clearState()
      emitJson({ ok: true, mode: 'release', version: facts.currentVersion, released: false, reason: '没有可生成的变更记录' })
      return
    }

    // 生成完必须**重算事实与计划**：此时已有待消费意图，阶梯应指向 confirm-bump。
    // 漏掉这一步会让流程拿着「generate-intents」的旧计划一路走到提交，跳掉 bump 与消费。
    facts = await collectFacts(args, token)
    plan = planRelease(facts)
  }
  else {
    log(`续跑：${plan.reason}`)
  }

  // ── 2. bump 确认 + 3. 消费意图 ───────────────────────────────────────────
  let entries: Intent[] = readEntriesForDisplay(facts)
  const oldVersion = currentVersion()
  let newVersion = oldVersion
  let bump: Bump = readState()?.bump ?? 'patch'

  if (plan.step === 'confirm-bump') {
    bump = await resolveBump(ui, args, entries, oldVersion, args.dryRun)
    // 全 none 的意图集 = 明确声明「这次不发版」：不消费、不打标、不推送
    if (!bumpChangesVersion(bump)) {
      log(`全部 ${entries.length} 个意图都声明 none：本次不发版（版本保持 v${oldVersion}）`)
      clearState()
      emitJson({ ok: true, mode: 'release', released: false, version: oldVersion, reason: '意图全部声明不发版（none）' })
      return
    }
    newVersion = nextVersionOrDie(ui, oldVersion, bump)
    entries = readEntriesForDisplay(facts)
    saveState({ fromVersion: oldVersion, toVersion: newVersion, bump, nextStep: 'consume-intents', baseTag: facts.baseTag, branch })
  }
  else if (plan.step === 'consume-intents') {
    newVersion = readState()?.toVersion ?? nextVersionOrDie(ui, oldVersion, bump)
    log(`续跑：按上次确认的 ${bumpLabel(bump)} 消费意图（目标 v${newVersion}）`)
  }

  if (plan.step === 'confirm-bump' || plan.step === 'consume-intents') {
    if (args.dryRun) {
      await ensureChangelogs(ui, { version: newVersion, dryRun: true })
      banner([`  🧪 --dry-run：将执行 pnpm version -r --no-git-checks（v${oldVersion} → v${newVersion}，${bump}）`, '', '  未做任何写操作'])
      emitJson({ ok: true, mode: 'release', dryRun: true, fromVersion: oldVersion, toVersion: newVersion, bump })
      return
    }

    log(`消费变更意图，更新版本号（目标 v${newVersion}）...`)
    const consumedVersion = await consumeIntents(ui, args, { oldVersion, newVersion })
    newVersion = consumedVersion

    // 收走消费后的残留：已消费的意图文件 + pnpm 的 changelogs 寄存区。
    // 放在 changelog 之前 ⇒ 本次 release commit 的 `git add -A` 不会再卷进它们。
    const collected = deleteConsumedIntents()
    if (collected.intents.length > 0 || collected.parked > 0) {
      log(`已收走 ${collected.intents.length} 个已消费的意图文件（ledger 仍记着它们；registry 模式下 pnpm 不回收）`
        + `${collected.parked > 0 ? `，并清掉 ${collected.parked} 个 pnpm 的 changelogs 寄存段落（只服务 publish，本仓不用）` : ''}`)
    }
    reportIntentsAfterConsume()

    // 3.5 changelog：git-cliff 逐包写（`storage: registry` 之后 pnpm 不再写 changelog —— 这里是唯一写入者）
    log('按包写 CHANGELOG（git-cliff）...')
    await ensureChangelogs(ui, { version: newVersion })

    // 3.6 Release 正文（根 changelog-latest.md）：必须在打 tag 之前写好并进提交
    log(`写 Release 正文（${'changelog-latest.md'}）...`)
    await writeReleaseNotes(ui, {
      version: newVersion,
      summaries: entries.map(entry => ({ packages: entry.packages, summary: `${entry.bump}: ${entry.summary}` })),
    })

    entries = readEntriesForDisplay(facts)
    saveState({ fromVersion: oldVersion, toVersion: newVersion, bump, nextStep: 'confirm-summary', baseTag: facts.baseTag, branch })
  }

  const freshFacts = await collectFacts(args, token)
  const newlyUnrelated = newlyUnrelatedChanges()

  // ── 4. 总览确认 ─────────────────────────────────────────────────────────
  if (plan.step === 'confirm-bump' || plan.step === 'consume-intents' || plan.step === 'confirm-summary') {
    // 续跑这一档（版本已 bump、还没提交）会跳过上面那段消费 —— 而 changelog 可能还没写
    // （中断在「消费成功、changelog 未写」之间）。幂等补一次：已有该版本段就跳过，不会写第二段。
    if (plan.step === 'confirm-summary') {
      await ensureChangelogs(ui, { version: newVersion })
      await writeReleaseNotes(ui, {
        version: newVersion,
        summaries: entries.map(entry => ({ packages: entry.packages, summary: `${entry.bump}: ${entry.summary}` })),
      })
    }
    // 续跑已 bump 未提交（confirm-summary）且非交互：不许在没人确认的情况下连带提交无关改动
    if (plan.step === 'confirm-summary' && !isInteractive() && newlyUnrelated.length > 0 && !args.allowDirty)
      die(2, `工作区新出现 ${newlyUnrelated.length} 个与发版无关的改动（非交互模式不替你决定）：${newlyUnrelated.join(', ')}。先 stash，或显式加 --allow-dirty`)

    await confirmSummary(ui, args, {
      entries,
      oldVersion,
      newVersion,
      bump,
      baseTag: freshFacts.baseTag,
      branch,
      unrelated: freshFacts.unrelated,
      tokenMasked: token ? maskToken(token) : null,
    })
    if (freshFacts.unrelated.length > 0 && !args.allowDirty)
      warn('无关改动会被一并提交（已在总览里列出）')
  }
  else if (plan.step === 'commit-tag-push' && freshFacts.versionConsumed && newlyUnrelated.length > 0 && !args.allowDirty) {
    die(2, `工作区新出现 ${newlyUnrelated.length} 个与发版无关的改动，续跑提交会带上它们。先 stash，或显式加 --allow-dirty`)
  }

  // ── 5. 提交 / 门禁 / 打标 / 推送 ────────────────────────────────────────
  saveState({ fromVersion: oldVersion, toVersion: newVersion, bump, nextStep: 'commit-tag-push', baseTag: freshFacts.baseTag, branch })
  await stepCommitTagPush(ui, newVersion, { commit: freshFacts.versionConsumed, skipGates: ARGS.skipGates })

  clearState()
  const tag = `v${newVersion}`
  const skip = skipGatesLabel(ARGS.skipGates)
  const remote = gitRemoteUrl()
  const releaseUrl = remote ? `${remote.replace(/\.git$/, '')}/releases/tag/${encodeURIComponent(tag)}` : null
  log(`✅ 发版完成: ${tag}${skip === '' ? '' : `  ⚠️ 本次${skip}`}`)
  log(`   GitHub Release 由 release.yml 在 tag 推送后创建${releaseUrl ? `：${releaseUrl}` : ''}`)
  log('   想确认它建好了：pnpm release --status（公开仓无需 token）')
  emitJson({
    ok: true,
    mode: 'release',
    released: true,
    version: newVersion,
    tag,
    branch,
    releaseUrl,
    releaseCreatedBy: 'release.yml',
    gatesSkipped: ARGS.skipGates,
    batterySkipped: ARGS.skipGates === 'all',
    batteryCount: releaseBatteryCount(),
    batteryPausedCount: releaseBatterySkippedCount(),
  })
}

/**
 * 总览要显示的「变更条目」。
 *
 * 意图被消费之后文件就没了（我们收走的），所以要按 **ledger** 反查本次版本消费了哪些意图 ——
 * 否则续跑时总览会打成「变更条目 0 条」，而它明明刚消费了几条，最容易被读成「什么都没做」。
 */
function readEntriesForDisplay(facts: CollectedFacts): Intent[] {
  const onDisk = readIntents()
  if (onDisk.length > 0)
    return onDisk
  const consumed = intentsOfVersion(facts.currentVersion)
  return consumed.map(id => ({ file: `${id}.md（已消费）`, packages: [], bump: 'patch' as Bump, summary: `意图 ${id}` }))
}

/**
 * 消费之后的意图对账。
 *
 * 已消费的文件在 `deleteConsumedIntents()` 里当场收走了（registry 模式下 pnpm 不回收），所以这里
 * 只剩一种要报的形态：**没被 ledger 记账却还在盘上**的意图 —— 那说明 `pnpm version -r` 没把它们
 * 消费掉（半写入 / 有人手写新意图），必须人工确认版本到底 bump 了没有。
 */
function reportIntentsAfterConsume(): void {
  const stale = unconsumedIntents()
  if (stale.length > 0)
    warn(`消费后仍有未记入 ledger 的意图：${stale.join(', ')}（请人工确认版本是否已 bump）`)
}

async function main(): Promise<void> {
  // 参数解析是**第一个**动作：入口点互斥矩阵也在里面判，任何错用都在动仓库之前以 2 结束
  const parsed = parseReleaseArgs(process.argv.slice(2))
  if (!parsed.ok) {
    process.stderr.write(`\x1B[31m[release]\x1B[0m ${parsed.message}\n`)
    process.exit(2)
  }
  ARGS = parsed.args
  setStateDryRun(ARGS.dryRun)

  if (ARGS.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }

  await mainRelease(ARGS)
}

// ── 信号处理 ──────────────────────────────────────────────────────────────

/** 「停在哪一步、重跑怎么接」—— 信号路径专用（正文在 report.ts） */
function printAbortHint(signal: NodeJS.Signals, plan: { step: ReleaseStep, reason: string } | null): void {
  process.stderr.write(`\n${abortHintLines({ signal, plan, state: readState() }).join('\n')}\n`)
}

/**
 * 按 shell 约定以 128+N 结束（130/143）。
 *
 * 顺序有讲究：先打印提示，再 `removeAllListeners` + 重发信号 —— JS 的信号回调是异步的，
 * 留着监听反而轮不到它；Node 走默认处置才会按信号结束进程。
 */
function hardExitBySignal(signal: NodeJS.Signals): never {
  process.removeAllListeners(signal)
  process.kill(process.pid, signal)
  throw new Error(`signal ${signal} 未能结束进程`)
}

/** 本次是否已被信号中止（`main().catch` 据此保持沉默：收尾与退出由信号路径负责） */
let abortSignal: NodeJS.Signals | null = null

/**
 * 中断收尾：**先确认子进程树真的死了**，再打印「停在哪一步」并退出。
 *
 * 为什么不能「打印完就自杀」：子进程被放到独立进程组 / 独立进程树，终端的 Ctrl+C 送不到它；
 * 父进程一退，`pnpm version -r` 就变成孤儿**继续改 manifest**，而终端上写着「已中止」。
 */
async function onInterrupt(signal: NodeJS.Signals): Promise<void> {
  if (abortSignal) {
    process.stderr.write('\n[release] 再按一次：立即退出（子进程可能仍在收尾）\n')
    hardExitBySignal(signal)
  }
  abortSignal = signal
  process.stderr.write(`\n[release] 收到 ${signal}：正在停手（收掉子进程树，最多等 ${(KILL_GRACE_MS / 1000).toFixed(0)}s；再按一次可立即退出）...\n`)
  const treeConfirmed = killActiveChild()
  const exited = await waitForActiveChildExit(KILL_GRACE_MS)
  if (!treeConfirmed || !exited)
    process.stderr.write('[release] ⚠️  无法确认子进程已退出：重跑前先确认没有残留进程在改工作区（Windows 可 tasklist 查 node）\n')

  // 「重跑会从哪接上」这句话必须对运行者成立 —— 所以**按事实重算**，不照抄状态文件
  // （那个文件是 gitignored 的本地记忆，换机器就没有了）。这里只跑本地只读查询，不联网。
  let plan: { step: ReleaseStep, reason: string } | null = null
  try {
    const facts = await collateFacts({ stateStep: readState()?.nextStep ?? null })
    plan = planRelease(facts)
  }
  catch (error: any) {
    process.stderr.write(`[release] （按事实重算下一步失败：${error?.message ?? error}；下面退回状态文件的说法）\n`)
  }
  printAbortHint(signal, plan)
  hardExitBySignal(signal)
}

function installSignalHints(): void {
  process.on('SIGINT', (signal: NodeJS.Signals) => {
    void onInterrupt(signal)
  })
  process.on('SIGTERM', (signal: NodeJS.Signals) => {
    void onInterrupt(signal)
  })
}

/**
 * 进程入口。**由 bin 调用，模块自身不在 import 时执行任何东西** ——
 * 早先在模块底部直接 `main().catch(…)` 而 bin 又调一次，导致同一次运行跑两遍
 * （`--plan` 的横幅原样打印了两次）。
 */
export async function run(): Promise<void> {
  installSignalHints()
  try {
    await main()
  }
  catch (error: any) {
    // 中断路径自己收尾并退出（已经打印过「收到 SIGINT」），这里保持沉默，免得盖住它
    if (abortSignal)
      return
    const message = error?.message ?? String(error)
    // 结构化错误的退出码：前置条件未满足 = 2，其余按 1
    const code: 1 | 2 = error instanceof PreconditionError || (error instanceof ChildRunError && error.exitCode === 2) ? 2 : 1
    process.stderr.write(`\x1B[31m[release]\x1B[0m ${message}\n`)
    emitJson({ ok: false, exitCode: code, error: message })
    process.exit(code)
  }
}

/**
 * 文本构造：总览 / `--status` / `--plan` / 演练横幅 / 中断提示 —— **纯函数**，无 IO、无颜色。
 *
 * 为什么单独成模块：这些文案是给人判断「要不要按 y」用的，必须能逐字断言（`__tests__/report.test.ts`）。
 * 散落在编排里的话，改一个空格就没人发现总览少了一行 —— 而那行可能正是「无关改动会被一起提交」。
 */

import type { Intent } from './intents.ts'

/** 状态文件在报告里的形状（只用到这几个字段，避免报告层依赖 state.ts 的完整类型） */
interface ReportState {
  nextStep: string
  toVersion: string
  bump: string
  updatedAt: string
}

export interface SummaryInput {
  entries: Intent[]
  oldVersion: string
  newVersion: string
  bump: string
  baseTag: string | null
  branch: string
  changedCount: number
  unrelated: string[]
  batteryCount: number
  batterySkipped: number
  tokenMasked: string | null
}

/**
 * 总览（确认前打印）。
 *
 * 必须包含的四件事：版本怎么变、将要**推送哪些 ref**、将要**提交多少文件**、以及
 * **无关改动会不会被一起带上**。最后一条尤其不能省 —— 它是唯一在提交前告诉人的机会。
 */
export function summaryLines(input: SummaryInput): string[] {
  const lines: string[] = [
    '  本次发版总览（确认后才会提交 / 打 tag / 推送）',
    '',
    `  版本      v${input.oldVersion} → v${input.newVersion}（${input.bump}）`,
    `  基线 tag  ${input.baseTag ?? '（无，首次发版）'}`,
    `  分支      ${input.branch}    标签 v${input.newVersion}`,
    `  变更条目  ${input.entries.length} 条`,
  ]
  for (const entry of input.entries.slice(0, 12))
    lines.push(`    - [${entry.bump}] ${firstLine(entry.summary)}`)
  if (input.entries.length > 12)
    lines.push(`    … 另有 ${input.entries.length - 12} 条`)

  lines.push(`  将提交    ${input.changedCount} 个文件（版本 + CHANGELOG + changelog-latest.md + ledger + 意图）`)
  lines.push(`  将执行    发版前全量电池 ${input.batteryCount} 条（boundaries / lint / types:check / test / syncpack / `
    + `change check / lint:workflows，分钟级${input.batterySkipped > 0 ? `；另有 ${input.batterySkipped} 条按配置暂缓` : ''}）`)
  lines.push(`  将推送    git push --atomic origin ${input.branch} v${input.newVersion}（一条 push；会触发 pre-push 门禁）`)
  lines.push(`  Release   由 release.yml 在 tag 推送后创建，正文取本次提交的 changelog-latest.md`)
  if (input.tokenMasked)
    lines.push(`  GitHub    git-cliff 用 ${input.tokenMasked} 补 PR 号与作者`)
  else
    lines.push('  GitHub    未提供 GITHUB_TOKEN：changelog 只有 commit 链接（无 PR 号/作者）')

  if (input.unrelated.length > 0) {
    lines.push('')
    lines.push(`  ⚠️ 与发版无关的改动 ${input.unrelated.length} 个（**会被一并提交**，想分开就先 stash）：`)
    for (const file of input.unrelated.slice(0, 12))
      lines.push(`    · ${file}`)
    if (input.unrelated.length > 12)
      lines.push(`    · … 另有 ${input.unrelated.length - 12} 个`)
  }
  return lines
}

export interface StatusInput {
  planOnly: boolean
  currentVersion: string
  baseTag: string | null
  baseVersion: string | null
  branch: string
  branchPushed: boolean
  pendingIntents: number
  versionConsumed: boolean
  localTagExists: boolean
  remoteTagExists: boolean
  remoteReleaseExists: boolean
  releaseChecked: boolean
  tag: string
  step: string
  stepText: string
  reason: string
  unrelated: string[]
  groupMisaligned: string[]
  state: ReportState | null
}

/**
 * `--status` / `--plan`。
 *
 * ⚠️ 这一面**不退出**（即使工作区半升级）：用户跑它就是想知道「为什么发不出去」，
 * 直接退出会让原因一个字都看不到。
 */
export function statusLines(input: StatusInput): string[] {
  const title = input.planOnly ? '发版计划（零写盘）' : '发版状态'
  const lines: string[] = [
    `  ${title}`,
    '',
    `  版本      v${input.currentVersion}    基线 ${input.baseTag ?? '（无 tag）'}`
    + `${input.baseVersion ? `（v${input.baseVersion}）` : ''}`,
    `  分支      ${input.branch}${input.branchPushed ? '' : '（有未推送提交）'}`,
    `  待消费意图 ${input.pendingIntents} 个`
    + `${input.versionConsumed ? '    ledger 有未提交改动' : ''}`,
    `  标签      ${input.tag}：本地 ${yesNo(input.localTagExists)} / 远端 ${yesNo(input.remoteTagExists)}`,
    `  Release   ${input.releaseChecked
      ? (input.remoteReleaseExists ? '远端已有' : '远端还没有（由 release.yml 创建）')
      : '未查询（缺 token 或网络不可达；公开仓无需 token，可加 GITHUB_TOKEN 重试）'}`,
    '',
    `  下一步    ${input.step} —— ${input.stepText}`,
    `  原因      ${input.reason}`,
  ]

  if (input.groupMisaligned.length > 0) {
    lines.push('')
    lines.push(`  ❌ 工作区不是可发版状态：fixed 组有 ${input.groupMisaligned.length} 个包没对齐到 v${input.currentVersion}`)
    for (const item of input.groupMisaligned.slice(0, 20))
      lines.push(`    · ${item}`)
    if (input.groupMisaligned.length > 20)
      lines.push(`    · … 另有 ${input.groupMisaligned.length - 20} 个`)
    lines.push('    修法：git checkout -- . 把改动全部还原，重跑 pnpm release')
  }

  if (input.unrelated.length > 0) {
    lines.push('')
    lines.push(`  与发版无关的改动 ${input.unrelated.length} 个（会被一并提交）：`)
    for (const file of input.unrelated.slice(0, 12))
      lines.push(`    · ${file}`)
    if (input.unrelated.length > 12)
      lines.push(`    · … 另有 ${input.unrelated.length - 12} 个`)
  }

  if (input.state) {
    lines.push('')
    lines.push('  状态文件（.changeset/.release-state.json，只影响提示）')
    lines.push(`    上次记的下一步  ${input.state.nextStep}    目标 v${input.state.toVersion}（${input.state.bump}）`)
    lines.push(`    更新时间        ${input.state.updatedAt}`)
  }
  return lines
}

export interface DryRunGenerateInput {
  generated: number
  target: string
  bump: string
  bumpOverridden: boolean
  batteryCount: number
}

/**
 * `--dry-run` 的演练横幅。
 *
 * ⚠️ 口径必须写死：不写盘 ⇒ 待消费意图恒为 0 ⇒ **只演练到第 1 步**。
 * 早先的实现会在这行之后补一句「没有可生成的变更记录，无需发版」，两句并列会让一次演练
 * 被读成「没有可发布的东西」。
 */
export function dryRunGenerateLines(input: DryRunGenerateInput): string[] {
  return [
    '  🧪 --dry-run：只演练到第 1 步（零写盘）',
    '',
    `  将生成     ${input.generated} 个意图`,
    `  目标版本   v${input.target}（${input.bump}${input.bumpOverridden ? '，由 --bump 指定' : '，自动检测'}）`,
    `  随后会跑   发版前全量电池 ${input.batteryCount} 条`,
    '  未演练     pnpm version -r / 提交 / 打标 / 推送 / changelog 落盘（它们要么改工作区要么打远端）',
    '',
    '  正式执行：pnpm release',
  ]
}

export interface AbortHintInput {
  signal: string
  plan: { step: string, reason: string } | null
  state: ReportState | null
}

/** Ctrl+C / SIGTERM 之后「停在哪一步、重跑怎么接」 */
export function abortHintLines(input: AbortHintInput): string[] {
  const lines: string[] = [
    `[release] 收到 ${input.signal} 已停手。`,
  ]
  if (input.plan) {
    lines.push(`[release] 按当前事实重算：下一步是 ${input.plan.step} —— ${input.plan.reason}`)
  }
  else {
    lines.push('[release] （按事实重算下一步失败，下面退回状态文件的说法）')
  }
  if (input.state)
    lines.push(`[release] 状态文件记的是：下一步 ${input.state.nextStep}，目标 v${input.state.toVersion}（${input.state.bump}）`)
  lines.push('[release] 直接重跑 pnpm release 即可从断点接上；想先看用 pnpm release --status。')
  lines.push('[release] 放弃本次发版：git checkout -- . && git clean -fd .changeset')
  return lines
}

/** 取摘要的第一行（意图正文可能多行） */
function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return line.length > 88 ? `${line.slice(0, 88)}…` : line
}

function yesNo(value: boolean): string {
  return value ? '有' : '无'
}

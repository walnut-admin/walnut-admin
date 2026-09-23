/**
 * 参数表 + 单趟解析 + **入口点互斥矩阵**。
 *
 * 为什么参数解析是 `main()` 的**第一个**动作：任何错用都必须在**动仓库之前**以 exit 2 结束。
 * 早先的实现没有解析层，唯一的输入通道是 readline 提问 —— 于是「非交互缺 flag」只能在流程跑到
 * 一半时才报出来，那时版本号已经被改过了（留下一个「改了版本号但没提交」的工作区）。
 *
 * 形式约定：`--flag value` 与 `--flag=value` **等价**（共用一条代码路径）；
 * `--skip-gates` 是唯一允许「裸用」（不带值）的 flag —— 裸用表示跳过全部门禁与电池。
 */

import type { Bump } from './intents.ts'

/** `--skip-gates` 的三种取值：null = 没跳；'all' = 门禁与电池一起跳；string[] = 只跳这几项 */
export type SkipGates = 'all' | string[] | null

export const CONSUME_ATTEMPTS_DEFAULT = 4

export interface ReleaseArgs {
  help: boolean
  yes: boolean
  json: boolean
  status: boolean
  plan: boolean
  intentOnly: boolean
  dryRun: boolean
  allowDirty: boolean
  /** 缺 GITHUB_TOKEN 时硬失败，而不是降级渲染（changelog 里就没有 PR 号/作者） */
  requireGithubMeta: boolean
  skipGates: SkipGates
  bump: Bump | null
  /** GitHub token：**只用于 git-cliff 的 API 富化**，不落盘、不建 Release */
  token: string | null
  consumeAttempts: number
}

const BOOLEAN_FLAGS: Record<string, keyof ReleaseArgs> = {
  '--help': 'help',
  '-h': 'help',
  '--yes': 'yes',
  '-y': 'yes',
  '--json': 'json',
  '--status': 'status',
  '--plan': 'plan',
  '--intent-only': 'intentOnly',
  '--dry-run': 'dryRun',
  '--allow-dirty': 'allowDirty',
  '--require-github-meta': 'requireGithubMeta',
}

const VALUE_FLAGS = ['--bump', '--token', '--consume-attempts'] as const

/** 互斥的「动作」入口：一次只能选一个 */
const ACTION_FLAGS: { flag: string, key: keyof ReleaseArgs }[] = [
  { flag: '--help', key: 'help' },
  { flag: '--status', key: 'status' },
  { flag: '--plan', key: 'plan' },
  { flag: '--intent-only', key: 'intentOnly' },
]

function defaultArgs(): ReleaseArgs {
  return {
    help: false,
    yes: false,
    json: false,
    status: false,
    plan: false,
    intentOnly: false,
    dryRun: false,
    allowDirty: false,
    requireGithubMeta: false,
    skipGates: null,
    bump: null,
    token: null,
    consumeAttempts: CONSUME_ATTEMPTS_DEFAULT,
  }
}

export type ParseResult
  = | { ok: true, args: ReleaseArgs }
    | { ok: false, message: string }

export function parseReleaseArgs(argv: string[]): ParseResult {
  const args = defaultArgs()
  const seen = new Map<string, string>()

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]

    if (!token.startsWith('-'))
      return { ok: false, message: `不接受位置参数：'${token}'（所有输入都走命名 flag，见 --help）` }

    // ── --skip-gates（唯一允许裸用的「可选值」flag）────────────────────────
    if (token === '--skip-gates') {
      args.skipGates = 'all'
      continue
    }
    if (token.startsWith('--skip-gates=')) {
      const value = token.slice('--skip-gates='.length).trim()
      if (value === '')
        return { ok: false, message: '--skip-gates= 后面要跟门禁 id（逗号分隔），或直接用裸 --skip-gates' }
      const ids = value.split(',').map(id => id.trim()).filter(Boolean)
      if (ids.length === 0)
        return { ok: false, message: '--skip-gates= 后面要跟至少一个门禁 id' }
      args.skipGates = ids
      continue
    }

    // ── 布尔 flag ────────────────────────────────────────────────────────
    if (BOOLEAN_FLAGS[token] !== undefined) {
      (args as unknown as Record<string, unknown>)[BOOLEAN_FLAGS[token]] = true
      continue
    }

    // ── 值 flag：`--flag value` 与 `--flag=value` 共用一条路径 ────────────────
    const [flag, inlineValue] = token.includes('=')
      ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
      : [token, null]

    if (!(VALUE_FLAGS as readonly string[]).includes(flag))
      return { ok: false, message: `未知参数：'${token}'（见 --help）` }

    let value = inlineValue
    if (value === null) {
      value = argv[index + 1] ?? null
      if (value === null || value.startsWith('--'))
        return { ok: false, message: `${flag} 需要给值` }
      index++
    }

    // 同一个值 flag 给了两个**不同**的值 → 拒绝（静默取最后一个会让人以为生效的是前一个）
    const previous = seen.get(flag)
    if (previous !== undefined && previous !== value)
      return { ok: false, message: `${flag} 给了两次且值不同：'${previous}' 与 '${value}'` }
    seen.set(flag, value)

    if (flag === '--bump') {
      if (value !== 'major' && value !== 'minor' && value !== 'patch')
        return { ok: false, message: `--bump 只能是 major | minor | patch，收到 '${value}'` }
      args.bump = value as Bump
    }
    else if (flag === '--token') {
      if (value.trim().length < 8)
        return { ok: false, message: `--token 看起来不是一个令牌（长度 ${value.trim().length} < 8）` }
      args.token = value.trim()
    }
    else {
      const attempts = Number(value)
      if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20)
        return { ok: false, message: `--consume-attempts 只能是 1..20 的整数，收到 '${value}'` }
      args.consumeAttempts = attempts
    }
  }

  // ── 入口点互斥矩阵 ──────────────────────────────────────────────────────
  // ⚠️ `--status` 与 `--plan` 的判定必须在通用的「多个入口」判定**之前**：两者都在 ACTION_FLAGS 里，
  // 通用判定会把它们拦成「这些入口一次只能用一个：--status / --plan」—— 行为对，但文案不如
  // 「它俩其实是同一件事的两种措辞」有用（用户多半是拿不准该用哪个，而不是想同时跑两个入口）。
  if (args.status && args.plan)
    return { ok: false, message: '--status 与 --plan 是同一个只读面的两种措辞，选一个即可' }

  const actions = ACTION_FLAGS.filter(action => args[action.key] === true)
  if (actions.length > 1) {
    return {
      ok: false,
      message: `这些入口一次只能用一个：${actions.map(action => action.flag).join(' / ')}`,
    }
  }

  const readOnlyEntry = args.help || args.status || args.plan || args.intentOnly

  // 只读入口不许带会写盘/推送的开关 —— 静默忽略它们会让人以为本次「演练过了门禁」
  if (readOnlyEntry && args.skipGates !== null && !args.help)
    return { ok: false, message: '--skip-gates 只对真正的发版有意义；--status / --plan / --intent-only 不跑门禁' }
  if ((args.status || args.plan) && args.dryRun)
    return { ok: false, message: '--dry-run 是「演练发版」，--status / --plan 是「看停在哪」；选一个即可' }

  return { ok: true, args }
}

/**
 * `--skip-gates` 的人类标签 —— 必须**复述**到完成行、`--json` 与 tag annotation 里。
 * 门禁被静默跳过是本仓最想避免的形态，所以跳过必须到处留痕。
 */
export function skipGatesLabel(skip: SkipGates): string {
  if (skip === null)
    return ''
  if (skip === 'all')
    return '已跳过发版前门禁与全量电池（--skip-gates）'
  return `已跳过发版前门禁项：${skip.join(' / ')}（--skip-gates=…）`
}

export const USAGE = `walnut-release —— walnut-admin 发版唯一入口

用法：
  pnpm release [选项]

流程（一条命令走完，中途失败可原样重跑并从断点接上）：
  0 前置      分支=main / 未落后上游 / fixed 组已对齐 / 钩子已装 / GITHUB_TOKEN（可选）
  1 生成意图  扫上次 tag 以来的 commit → 归属到包 → pnpm change --bump --summary <pkg…>
  2 确认 bump 列出意图摘要 + 预期版本 → 交互确认，或 --bump 覆盖
  3 消费意图  pnpm version -r --no-git-checks（版本 + ledger）
  3.5 changelog 逐包 git-cliff 渲染 → 写 <包>/CHANGELOG.md（唯一写入者，幂等）
  3.6 notes     整仓本次发版段落 → 写根 changelog-latest.md（CI 的 Release 正文源）
  4 总览确认  包归属 / bump / 版本 / 条目 / 将提交文件数 / 将推 refs / 相关无关改动 → Y/n
  5 提交发布  git add -A → commit "chore(release): vX.Y.Z" → 发版前门禁 + 全量电池
              → git tag -a → git push --atomic origin main vX.Y.Z
  6 完成      GitHub Release 由 .github/workflows/release.yml 在 tag 推送后创建

只读面（零写盘、零推送，不交互）：
  --status            现在停在哪一步、下一步是什么、为什么（含工作区与远端事实）
  --plan              同上，但按「计划」措辞
  --intent-only       只生成变更意图，不做后续任何事
  --dry-run           演练：打印将生成的意图 + 目标版本/tag + 后续命令链（**只演练到第 1 步**）

交互面（只在「是 TTY 且没给对应 flag」时发生；非交互缺 flag 一律 exit 2 且此时尚未改动任何文件）：
  ① 确认版本升级类型   → --bump major|minor|patch
  ② 变更总览确认       → --yes / -y

选项：
  --bump major|minor|patch   选定升级级别（非交互必填）
  --yes, -y                  跳过总览确认（非交互必填）
  --allow-dirty              允许与发版无关的改动被一并提交（默认拦截本次运行期间新出现的无关改动）
  --skip-gates               跳发版前门禁**与**全量电池（会写进 tag annotation，事后可审计）
  --skip-gates=<id>[,<id>]   只跳这几项，其余项与全量电池照跑（未知 id 退 2）
  --token <值>               GitHub token（**只用于** git-cliff 补 PR 号/作者；不落盘、不建 Release）
  --require-github-meta      缺 GITHUB_TOKEN 时硬失败，而不是降级渲染 changelog
  --consume-attempts <1..20> 消费意图的重试次数（默认 ${CONSUME_ATTEMPTS_DEFAULT}）
  --json                     人类日志全部走 stderr，stdout 只放一个 JSON 结果
  --help, -h                 本页

环境变量：
  GITHUB_TOKEN           git-cliff 调 GitHub API 用（未认证时 60 次/小时，够一次发版）。
                         ⚠️ 它不会进入任何子进程（见 src/release/env.ts），也不会写进任何文件。
  RELEASE_CMD_TIMEOUT_MS 单条子命令的预算（默认 15 分钟）
  CONSUME_TIMEOUT_MS     pnpm version -r 的预算（默认 3 分钟）

退出码：
  0 完成（含「无需发版」「已在目标状态」）
  1 检出不一致 / 子步骤失败（fixed 组不一致、HEAD 版本复核失败、提交后工作区仍脏、
    门禁或电池未过、changelog 渲染失败、push 失败）
  2 前置条件未满足（不在 main、落后上游、fixed 组半升级、非交互缺 flag、未知 --skip-gates id）
  信号中断：POSIX 按 128+N（130/143）；Windows 上表现为 1
`

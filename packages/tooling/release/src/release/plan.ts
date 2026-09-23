/**
 * 发版流程的「续跑阶梯」与发布说明组装 —— 纯逻辑，无 IO。
 *
 * 为什么需要它：发版是**多步且不可逆**的（消费意图 / 打 tag / push），任何一步失败或用户 Ctrl+C
 * 之后重跑，都必须从断点续上：既不重复生成意图，也不在已 bump 的版本上再 bump 一次。把「现在到底
 * 停在哪一步」变成一个对若干事实求值的纯函数后，就能用单测把每条断点路径钉住。
 *
 * 事实由调用方从 git / 工作区 / ledger / 远端取；本模块只回答「下一步该做什么」与「为什么」。
 */

export type ReleaseStep
  = | 'generate-intents'
    | 'confirm-bump'
    | 'consume-intents'
    | 'confirm-summary'
    | 'commit-tag-push'
    | 'done'

export interface ReleaseFacts {
  /** 待消费意图数（**以 ledger 为准**：文件被 pnpm 删掉/保留都不影响这个数） */
  pendingIntents: number
  /** `ledger.yaml` 有未提交改动 —— **只作显示**：真正的「还没提交」判据是 `bumpUncommitted` */
  versionConsumed: boolean
  /** HEAD 是否就是 `chore(release): vX.Y.Z` 提交（值 = tag 名，否则 null）——只用于解释原因 */
  releaseCommit: string | null
  /** 当前 `apps/admin` 的 version（= 单一 fixed 组的版本 = 发版 tag 的来源） */
  currentVersion: string
  /** 当前分支名 */
  branch: string
  /** 上一个 tag（`git describe --tags --abbrev=0`），没有历史 tag 时为 null */
  baseTag: string | null
  /** 上一个 tag 处的 version，取不到为 null */
  baseVersion: string | null
  /** 本地是否已有 `v<currentVersion>` 标签 */
  localTagExists: boolean
  /** 远端是否已有 `v<currentVersion>` 标签 */
  remoteTagExists: boolean
  /** 远端是否已有该 tag 的 GitHub Release（**只读探测**：Release 由 CI 创建） */
  remoteReleaseExists: boolean
  /** 远端 Release 探测是否**成功**：探测失败时 `remoteReleaseExists` 无意义，不能当成「没有」 */
  releaseChecked: boolean
  /** 当前分支是否已与上游同步（无未推送提交）；仅用于显示与「release 提交未推」判定 */
  branchPushed: boolean
  /** 上个 tag 以来的提交数（0 = 没有待发布的新提交） */
  commitsSinceTag: number
  /** 上次运行留下的「下一步」（`.changeset/.release-state.json`）；null = 没有可用的续跑记忆 */
  stateStep: ReleaseStep | null
  /** 版本已 bump 但**还没提交**：HEAD 上的版本 ≠ 工作区版本（直接事实，不靠 ledger 脏度推测） */
  bumpUncommitted: boolean
  /** fixed 组里**没对齐到当前版本**的包；非空 = 半升级工作区（不可发版，先修） */
  groupMisaligned: string[]
}

export interface ReleasePlan {
  step: ReleaseStep
  /** 本次要处理的 tag（`v<currentVersion>`） */
  tag: string
  /** 停在/进入这一步的原因（给人看，也给 AI 看） */
  reason: string
}

/** 版本号是否已经离开上一个 tag 的基线（⇒ 版本已 bump，只剩提交/打标/推送） */
export function isBumped(facts: Pick<ReleaseFacts, 'currentVersion' | 'baseVersion'>): boolean {
  return facts.baseVersion !== null && facts.baseVersion !== facts.currentVersion
}

/**
 * 续跑阶梯：**顺序即优先级**，每一步的判断都只看「可观测事实」而不是上一次运行的记忆。
 *
 * 顺序上有一条**不能动**的性质：**「已 bump」排在「有待消费意图」之前**。
 * 反过来的写法（意图数优先）在「消费只删了一半意图」时会让重跑**在一个已经 bump 过的版本上再 bump
 * 一档** —— 而 tag 是下游部署的选择器，多一档就是一个错的版本号被发出去。
 * 状态文件（`.release-state.json`，gitignored）只在**一档**上生效：`consume-intents`
 * （意图仍在、版本未变，只有「上次已经选好 bump」这件事值得记住），其余判定全不依赖它，
 * 所以换机器 / 新 clone 也能正确接上。
 */
export function planRelease(facts: ReleaseFacts): ReleasePlan {
  const tag = `v${facts.currentVersion}`
  const at = (step: ReleaseStep, reason: string): ReleasePlan => ({ step, tag, reason })

  // ① 已 bump：工作区版本已经离开上一个 tag —— 不能再 bump 一次，只能往前走到提交/打标/推送。
  if (isBumped(facts)) {
    if (facts.bumpUncommitted)
      return at('confirm-summary', `工作区版本已是 v${facts.currentVersion}（HEAD 上还是 v${facts.baseVersion}）但还没提交 —— 从总览确认续跑`)
    return at('commit-tag-push', `工作区版本已从 v${facts.baseVersion} 变成 v${facts.currentVersion}，只剩提交/打标/推送`)
  }

  // ② 上次已确认 bump、还没消费：意图仍在、版本未变，用记忆省掉重答一次（不改变任何写盘事实）。
  if (facts.stateStep === 'consume-intents' && facts.pendingIntents > 0)
    return at('consume-intents', `上次已确认 bump 但还没消费（${facts.pendingIntents} 个意图仍在）—— 从消费这一步续跑`)

  // ③ 有未消费意图：先确认 bump 再消费。
  if (facts.pendingIntents > 0)
    return at('confirm-bump', `有 ${facts.pendingIntents} 个待消费变更意图（上次运行生成后中断，或本次刚生成）`)

  if (facts.localTagExists && !facts.remoteTagExists)
    return at('commit-tag-push', `本地已有标签 ${tag} 但远端没有 —— 补推`)

  // 只有「未推送的提交正是本次 release 提交」才算发版待办：否则那只是普通未推送代码，
  // 交给 git push 就好，发版流程不该顺手把它推上去（更不该为旧版本补建任何东西）。
  if (facts.localTagExists && facts.remoteTagExists && !facts.branchPushed && facts.releaseCommit === tag)
    return at('commit-tag-push', `标签 ${tag} 已发布，但 release 提交所在的 ${tag} 还没推到分支 —— 补推分支`)

  // 顺序要紧：**有新提交就向前走**（用户显然在准备下一个版本）。
  if (facts.remoteTagExists && facts.commitsSinceTag > 0)
    return at('generate-intents', `上个 tag v${facts.baseVersion} 以来有 ${facts.commitsSinceTag} 个新提交 —— 生成意图发新版本`)

  if (facts.remoteTagExists)
    return at('done', `标签 ${tag} 已在远端、且没有新提交 —— 没有要做的`)

  return at('generate-intents', '无待消费意图且版本未变 —— 从上次 tag 以来的 commit 生成意图')
}

const STEP_TEXT: Record<ReleaseStep, string> = {
  'generate-intents': '扫描 commit 生成变更意图',
  'confirm-bump': '确认版本升级类型（major / minor / patch）',
  'consume-intents': '消费意图：pnpm version -r（改版本 + 写 ledger）',
  'confirm-summary': '输出本次变更总览并等你确认',
  'commit-tag-push': '提交版本变更 → 跑门禁 → 打 tag → 推分支与 tag',
  'done': '已完成',
}

/** 一步的人话说明（`--status` / 中断提示用） */
export function describeStep(step: ReleaseStep): string {
  return STEP_TEXT[step]
}

/** 从 CHANGELOG.md 里取某个版本的段落（`## 1.9.0` 起，到下一个 `## ` 或文件末尾） */
export function extractChangelogSection(markdown: string, version: string): string | null {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => line.trim() === `## ${version}`)
  if (start < 0)
    return null
  const rest = lines.slice(start)
  const next = rest.findIndex((line, index) => index > 0 && /^##\s/.test(line))
  const section = (next < 0 ? rest : rest.slice(0, next)).join('\n').trim()
  return section || null
}

export interface ReleaseNoteInput {
  version: string
  /** 整仓本次发版的 git-cliff 渲染结果（首选：覆盖全部包） */
  cliffNotes?: string | null
  /** 意图摘要（cliff 渲不出来时兜底） */
  summaries: { packages: string[], summary: string }[]
}

/**
 * 正文实际取自哪一档。判据与 `buildReleaseNotes()` **必须同一份**：分头推导迟早会漂成
 * 「日志说用 cliff、正文其实是摘要」这种最难查的形态。
 */
export function releaseNoteSource(input: ReleaseNoteInput): 'cliff' | 'intents' | 'placeholder' {
  if (input.cliffNotes)
    return 'cliff'
  return input.summaries.length > 0 ? 'intents' : 'placeholder'
}

/**
 * 组装写进 `changelog-latest.md`（= CI 的 GitHub Release 正文）的内容。
 *
 * ⚠️ 为什么这一档必须有兜底：`release.yml` 的 release job 在 `verify` + `images` **之后**才跑，
 * 那时 tag 已经推上去了。正文文件如果没随 release commit 提交，CI 会去读上一个版本留下的内容，
 * 或者干脆读不到 —— 两种情况都会让 Release 正文与本次发版对不上。
 */
export function buildReleaseNotes(input: ReleaseNoteInput): string {
  if (input.cliffNotes)
    return `${input.cliffNotes}\n\n---\n由 \`pnpm release\` 生成（v${input.version}）。`
  if (input.summaries.length > 0) {
    const bullets = input.summaries
      .map(item => `- ${item.summary}${item.packages.length > 0 ? `（${item.packages.join(', ')}）` : ''}`)
      .join('\n')
    return `## v${input.version}\n\n${bullets}\n\n---\n由 \`pnpm release\` 生成（cliff 渲染不可用，退回意图摘要）。`
  }
  return `## v${input.version}\n\n本次发版没有可摘录的变更条目。\n\n---\n由 \`pnpm release\` 生成。`
}

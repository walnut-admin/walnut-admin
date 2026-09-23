/**
 * 第 4–5 步的步骤体：总览确认 → 提交 / 门禁 / 打标 / 推送。
 *
 * 为什么单独成模块：这几步是**不可逆动作**（commit / tag / push），它们的守卫
 * （未消费意图、HEAD 版本、tag 指向、提交后干净、**门禁在打标之前**）必须挨着动作写才看得出顺序。
 *
 * 失败口径：一律经 `ui.die(码, 话)` 交给 CLI —— 本模块不自己退出（退出码是 CLI 的策略）。
 * 不做什么：不消费意图（consume.ts）、不算版本号、不写 changelog。
 */

import type { ReleaseArgs, SkipGates } from './args.ts'
import type { Intent } from './intents.ts'
import type { ReleaseUi } from './ui.ts'
import { runArgs } from '@walnut/scripts/lib/child-run'
import {
  branchIsPushed,
  changedFileCount,
  currentBranch,
  headCommit,
  headSubject,
  porcelain,
  tagCommit,
  tagExistsLocally,
  tagExistsRemotely,
} from '@walnut/scripts/lib/git'
import { assertSafeRef } from '@walnut/scripts/lib/ref-guard'
import { REPO_ROOT } from '@walnut/scripts/lib/repo-root'
import { skipGatesLabel } from './args.ts'
import { summaryLines } from './report.ts'
import { unconsumedIntents, versionAtRef } from './workspace.ts'

// ── 全量电池（发版前在本地跑 CI 会跑的那些面）────────────────────────────────

interface BatteryStep {
  /** `--skip-gates=<id>` 用的稳定 id */
  id: string
  label: string
  argv: string[]
  /** 非空 = 该条**暂缓**（每次跑都会打 `⏭️` 一行，绝不静默少跑） */
  skip?: string
}

/**
 * 全量电池的表。**判据**：`pnpm release` 是净覆盖最广的面，所以 CI 里的质量门禁在这里都要跑一遍。
 *
 * 为什么 `lint` 走 `turbo run lint` 而不是根 `pnpm lint`：两者等价，但显式写 turbo argv 让
 * 「跑的是所有包的 lint 任务」在表里一眼可见。**仓库级文件**（根 `.ts` / `.json` / `.yaml`）的 lint
 * 是**独立的一行** `lint:root`（见下），省掉它就会静默漏掉根级文件的 lint。
 *
 * 为什么 `build` 默认暂缓：镜像构建由 `release.yml` 的 images job 真正承担（那才是交付物），
 * 本地全量 build 是分钟级且需要 `pnpm setup-env` 解密后的 env —— 它拦住的多半是环境没配好，
 * 而不是代码问题。要跑就删掉该行的 `skip` 字段（命令与判据都原样留在表里）。
 *
 * ⚠️ 本表必须**整表被遍历**（`for (const step of RELEASE_BATTERY)`）：把这里改成空数组会让
 * 「表还在、命令没人跑」当场发生。`__tests__/steps.test.ts` 同时钉住遍历与每条 argv。
 */
const RELEASE_BATTERY: BatteryStep[] = [
  // 第 0 步：**本机的 git 钩子还活着吗**。
  // 为什么只有这里检查得到：`prepush` 本身就是钩子调的 —— 钩子没装时 prepush 根本不会跑，
  // 所以它保护不了自己。`pnpm release` 是**不经钩子**的入口，是唯一能观察到「本机门禁是否
  // 已经静默失效」的位置。`lefthook.yml` 顶部那句「发版第 0 步也会调它」描述的就是这里
  // （2026-09-23 之前那句是**空头承诺**：`hooks:check` 当时全仓零自动调用点）。
  // 失败语义是「前置条件未满足」（exit 2）而不是「查出违规」，这正是本仓三态退出码的用法。
  { id: 'hooks', label: 'git 钩子托管校验（pnpm hooks:check）', argv: ['hooks:check'] },
  { id: 'boundaries', label: '架构边界（turbo boundaries）', argv: ['boundaries'] },
  { id: 'lint', label: 'lint（所有包，不排任何包）', argv: ['exec', 'turbo', 'run', 'lint'] },
  // ⚠️ `types-root` 必须是**独立一行**、且经根脚本跑（`pnpm types:check:root`）—— 它只是根
  // `package.json` 的脚本，**没有**对应的 turbo 任务，写进 turbo 的 argv 会直接
  // `Could not find task` 退出。
  // （`lint-root` 一度也是这个形态，2026-09-23 起不是了：根 turbo.json 定义了 `//#lint:root`
  //  根任务，所以它现在走 `turbo run lint:root` 从而可缓存 —— 别按旧结论改回去。）
  { id: 'lint-root', label: 'lint 根级配置（turbo run //#lint:root）', argv: ['exec', 'turbo', 'run', 'lint:root'] },
  { id: 'types', label: '类型检查（不排任何包）', argv: ['exec', 'turbo', 'run', 'types:check'] },
  // 根 tsconfig.json（include: ["*.ts"]）覆盖 eslint.config.ts / commitlint.config.ts / knip.config.ts，
  // 这三者不入 turbo 的图。与 lint-root 同理：**独立一行**、经根脚本跑，不能写进上面的 turbo argv。
  { id: 'types-root', label: '根级配置类型检查（pnpm types:check:root）', argv: ['types:check:root'] },
  { id: 'test', label: '测试（不排任何包）', argv: ['exec', 'turbo', 'run', 'test'] },
  { id: 'syncpack', label: '依赖一致性（syncpack）', argv: ['syncpack:lint'] },
  { id: 'versioning', label: 'workspace 版本锁步（pnpm change check）', argv: ['change', 'check'] },
  { id: 'workflows', label: 'workflow 校验（actionlint）', argv: ['lint:workflows'] },
  // 与上面同理：它是 @walnut/scripts 的 bin（根脚本），**不是** turbo 任务。
  // 活文档正文里引用的包名/仓库路径必须真实存在 —— VitePress 内置只查 markdown 链接。
  { id: 'docs-refs', label: '文档引用校验（包名 / 仓库路径）', argv: ['lint:docs-refs'] },
  // 同上：@walnut/scripts 的 bin。ADR 的形态（编号连续 / Status 在枚举内 / 四个必需小节 /
  // index.md 双向对齐）没有任何现成工具管，见待办 F6。
  { id: 'adr', label: 'ADR 形态校验（编号 / 状态 / 小节）', argv: ['lint:adr'] },
  // 同上。文档里标成 `ts` 的围栏块必须能按 TypeScript 解析（JSON 块不许标成 ts）。
  { id: 'doc-ts', label: '文档代码块校验（ts 块必须能解析）', argv: ['lint:doc-ts'] },
  // 同上。常驻上下文的几个文件（根 AGENTS.md / CLAUDE.md / 包级指引）不许无限膨胀。
  { id: 'doc-budget', label: '文档字数预算（常驻文件不许膨胀）', argv: ['lint:doc-budget'] },
  // 同上。turbo.json 写错一个产物目录/依赖边不会报错，只会让 turbo 报 FULL TURBO 却少跑或少产出；
  // 同一个文件里的 tags 写错则会让那个包**静默豁免于整套 boundaries**。
  { id: 'turbo-cache', label: 'turbo 配置不变量（缓存边界 + tags）', argv: ['lint:turbo-cache'] },
  // 同上。改 catalog 忘了 `pnpm install` = 本地全绿、CI 死在 install —— 发版面必须也看得见。
  { id: 'lockfile', label: 'catalog 与锁文件锁步', argv: ['lint:lockfile'] },
  // 同上。入口 nginx 的 4 个安全头：`add_header` 是整段替换而不是合并，写漏一条就静默裸奔。
  // 发版面能看见它还有一层意义 —— 部署用的就是这份 `deploy/nginx/conf.d/`。
  { id: 'nginx-headers', label: '入口 nginx 安全响应头（conf.d）', argv: ['lint:nginx-headers'] },
  {
    id: 'build',
    label: '构建（3 个 app + 共享包）',
    argv: ['build'],
    skip: '镜像由 release.yml 的 images job 真正构建；本地全量 build 是分钟级且需要 setup-env 解密后的 env。要跑就删掉本行的 skip。',
  },
  // 与上面的 `build` 是**一对**：它扫的就是 `apps/admin/dist`，没有构建就没有产物
  // （那时它是"前置条件未满足"退出码 2，而不是静默通过）。解冻时两条一起解冻。
  {
    id: 'dist-secrets',
    label: '产物去密体检（apps/admin/dist）',
    argv: ['lint:dist'],
    skip: '需要 `apps/admin/dist` —— 与上面的 build 同步：本地没构建时它只会报"前置条件未满足"。真跑它请一起解开 build。',
  },
]

/** 全量电池**会跑**的条数（演练横幅用；跳过的不算） */
export function releaseBatteryCount(): number {
  return RELEASE_BATTERY.filter(step => step.skip === undefined).length
}

/** 被 `skip` 暂缓的条数 */
export function releaseBatterySkippedCount(): number {
  return RELEASE_BATTERY.filter(step => step.skip !== undefined).length
}

/** 全量电池**会跑**的 argv 序列（给用例断言「表被整表遍历」，而不是「字面量还在文件里」） */
export function releaseBatteryArgvs(): string[][] {
  return RELEASE_BATTERY.filter(step => step.skip === undefined).map(step => [...step.argv])
}

/** 全部电池 id（`--skip-gates=<id>` 的值域） */
export function releaseBatteryIds(): string[] {
  return RELEASE_BATTERY.map(step => step.id)
}

/** 被 `skip` 暂缓的条目（横幅与用例用） */
export function releaseBatterySkips(): { id: string, skip: string }[] {
  return RELEASE_BATTERY
    .filter(step => step.skip !== undefined)
    .map(step => ({ id: step.id, skip: step.skip! }))
}

/**
 * 跑全量电池，**逐条**报进度并在任一条失败时收场（`ui.die` ⇒ 此时 tag 还没打，不留本地 tag）。
 *
 * 走 `ui.runPnpmStep`（实况转播）而不是同步执行：分钟级命令会把事件循环钉住（心跳与 SIGINT
 * 回调都轮不到），失败输出超过缓冲上限时还会被误报成「启动失败」。
 */
async function runReleaseBattery(ui: ReleaseUi, skippedIds: Set<string>): Promise<void> {
  const failures: string[] = []
  for (const step of RELEASE_BATTERY) {
    if (step.skip !== undefined) {
      // 暂缓的条目**响亮跳过**：打一行 ⏭️ + 原因，绝不静默少跑（静默弱化门禁是本仓最想避免的形态）
      ui.log(`⏭️ 跳过 ${step.label}：${step.skip}`)
      continue
    }
    if (skippedIds.has(step.id)) {
      ui.log(`⏭️ 跳过 ${step.label}：--skip-gates=${step.id}`)
      continue
    }
    ui.log(`▶️ ${step.label}`)
    try {
      await ui.runPnpmStep(step.argv, `pnpm ${step.argv.join(' ')}`)
    }
    catch (error: any) {
      const exitCode = Number(error?.exitCode ?? 1)
      const why = `发版前全量电池未通过：${step.label} 失败（${error?.message ?? error}）。`
        + '在这里拦住好过推出去才发现（tag 还没打，不留需要手工清理的本地 tag）；'
        + `确实要带病发版请显式加 --skip-gates。`
      if (exitCode === 2)
        ui.die(2, why)
      failures.push(step.id)
      ui.die(1, `${why}\n   失败的项 id：${step.id}（只想跳它：--skip-gates=${step.id}）`)
    }
  }
  ui.log(`✅ 发版前全量电池全绿（${releaseBatteryCount()} 条）`)
}

/**
 * 打 tag **之前**跑的门禁。
 *
 * 为什么必需：`release` 自己不跑门禁时，它**完全依赖** `git push` 顺带触发的 pre-push 钩子 ——
 * 而 push 发生在打 tag **之后**。于是「本地全绿、发版成功、CI 的 verify 却红」是可达的，
 * 那时远端已经有一个指向坏提交的 tag。
 * 两个调用点（首发与续跑）都在「打完 tag 之前」：失败 ⇒ 不留本地 tag，改完直接重跑即可。
 */
async function runReleaseGates(ui: ReleaseUi, target: string, skipGates: SkipGates): Promise<void> {
  if (skipGates === 'all') {
    ui.log('⚠️ --skip-gates：跳过了发版前全量电池（本次发版不会在本地验 CI 会跑的那些项）')
    return
  }

  const pool = releaseBatteryIds()
  const skippedIds = new Set<string>()
  if (skipGates !== null) {
    const unknown = skipGates.filter(id => !pool.includes(id))
    if (unknown.length > 0)
      ui.die(2, `--skip-gates 里有未知的 id：${unknown.join(' / ')}（可选：${pool.join(' / ')}）`)
    for (const id of skipGates)
      skippedIds.add(id)
    ui.log(`⚠️ --skip-gates：跳过 ${skipGates.join(' / ')}，其余项照跑`)
  }

  ui.log(`跑发版前全量电池（${releaseBatteryCount()} 条，分钟级；失败则拒绝打 tag ${target}）...`)
  await runReleaseBattery(ui, skippedIds)
}

// ── 第 4 步：总览 + 确认 ──────────────────────────────────────────────────

export interface SummaryInput {
  entries: Intent[]
  oldVersion: string
  newVersion: string
  bump: string
  baseTag: string | null
  branch: string
  unrelated: string[]
  tokenMasked: string | null
}

export async function confirmSummary(ui: ReleaseUi, args: ReleaseArgs, input: SummaryInput): Promise<void> {
  ui.banner(summaryLines({
    entries: input.entries,
    oldVersion: input.oldVersion,
    newVersion: input.newVersion,
    bump: input.bump,
    baseTag: input.baseTag,
    branch: input.branch,
    changedCount: changedFileCount(),
    unrelated: input.unrelated,
    batteryCount: releaseBatteryCount(),
    batterySkipped: releaseBatterySkippedCount(),
    tokenMasked: input.tokenMasked,
  }))

  if (args.yes) {
    ui.log('--yes：跳过总览确认，直接执行')
    return
  }
  if (!ui.isInteractive())
    ui.die(2, '非交互环境必须显式确认：加 --yes（只想看计划用 --plan；想零写盘演练用 --dry-run）')

  if (input.unrelated.length > 0 && !args.allowDirty)
    ui.warn('上面列出的「无关改动」会被一起提交；确认继续请输入 y，或先 stash 后重跑')

  const answer = (await ui.ask('  确认执行? [Y/n]: ')).trim().toLowerCase()
  if (answer === '' || answer === 'y' || answer === 'yes') {
    ui.log('已确认，继续')
    return
  }
  ui.die(2, `已取消（版本号已 bump 到 v${input.newVersion}，尚未提交）。`
  + '重跑 pnpm release 会回到这一步；彻底放弃执行：git checkout -- . && git clean -fd .changeset')
}

// ── 第 5 步：提交 / 打标 / 推送 ───────────────────────────────────────────

export interface CommitTagPushOptions {
  /** 版本改动是否还没提交（`versionConsumed`）。false = 补推续跑，**不许** `git add -A` */
  commit: boolean
  skipGates: SkipGates
}

/**
 * 提交 → 门禁 → 打 tag → 推送。
 *
 * `options.commit` 的语义很关键：只有「版本改动还没提交」时才 `git add -A` + commit —— 否则
 * （例如只是补推失败的那一步）工作区里的东西与本次发版无关，`git add -A` 会把它们卷进一个
 * 假的 release commit。
 */
export async function stepCommitTagPush(ui: ReleaseUi, newVersion: string, options: CommitTagPushOptions): Promise<void> {
  const tag = `v${newVersion}`

  // 防线 ①：走到提交时不得还有**未消费**意图（否则说明阶梯与流程错位 —— 绝不能提交一个没 bump 的 release commit）
  const stale = unconsumedIntents()
  if (stale.length > 0) {
    ui.die(1, `流程错位：仍有 ${stale.length} 个未消费意图（${stale.join(', ')}），拒绝提交 release commit。`

    + '请把这条日志给我。')
  }

  const branch = currentBranch()

  if (!options.commit) {
    ui.log(`版本变更已提交过，跳过提交（HEAD: ${headSubject() ?? '?'}）`)
  }
  else {
    const dirty = porcelain(true).join('\n').trim()
    if (dirty === '') {
      ui.log(`工作区干净，跳过提交（HEAD: ${headSubject() ?? '?'}）`)
    }
    else {
      ui.log('提交版本变更...')
      // `-C REPO_ROOT`：`git add .` 只覆盖 **cwd** 子树，从子目录跑会漏掉版本改动
      await runArgs('git', ['-C', REPO_ROOT, 'add', '-A'], ui.childOptions())
      // ⚠️ 提交失败**必须当场中断**，绝不能被 catch 吞成「没有需要提交的变更」。
      // 走到这里的前提是工作区非空 ⇒ 确实有东西要提交，所以失败只有一种解释：提交本身被拒
      // （pre-commit 的 lint-staged lint 失败 / 缺 user.email / commit-msg 钩子拒绝）。
      // 吞掉它的后果是：流程照常打 tag、push，**远端得到一个不含版本号的 vX.Y.Z tag**，
      // 而人被告知发版完成 —— 这正是本仓最想避免的「绿着却做错了」形态。
      //
      // ⚠️ 提交信息必须带 scope：本仓 commitlint 的 `scope-empty: never` 会拒绝 `chore: release …`，
      // 而 `release` 是保留的基础设施 scope（不是包 scope）。
      await runArgs('git', ['-C', REPO_ROOT, 'commit', '-m', `chore(release): v${newVersion}`], ui.childOptions())
    }
  }

  // 防线 ②：提交后不变式 —— 走过 `git add -A` + commit 之后工作区必须干净。
  // 不干净说明有东西没进提交（预提交钩子改了文件却没重暂存 / 别的进程在写 / 提交被跳过），
  // 而接下来的 tag 会指向那个提交。
  if (options.commit) {
    const leftover = porcelain(true)
    if (leftover.length > 0) {
      ui.log('❌ 提交后工作区仍有改动：')
      for (const line of leftover.slice(0, 8))
        ui.log(`   ${line}`)
      ui.die(1, `拒绝打标：release 提交之后工作区仍有 ${leftover.length} 个改动（tag 会指向一个不完整的提交）。先查清再重跑`)
    }
  }

  // 防线 ③：打标前的独立复核 —— **不可回退的不变量**是「HEAD 必须带着本次版本号」。
  // 上面两个跳过分支各有各的前提（`!commit` = 早先已提交；工作区已干净），前提错了就会打出错 tag，
  // 而 tag 与 push 都不可回退。故不看「我们以为做过什么」，只看 HEAD 上实际是什么。
  const headVersion = versionAtRef('HEAD')
  if (headVersion !== newVersion) {
    ui.die(1, `拒绝打标：HEAD 上的 apps/admin 版本是 ${headVersion ?? '(读不到)'}，而本次要发 ${newVersion}。`
    + '说明 release commit 没落到 HEAD（预提交钩子拒绝 / 提交被跳过 / 早先的提交不完整）。'
    + `HEAD: ${headSubject() ?? '?'}。`
    + '请先查清再重跑；若要放弃本次发版：git checkout -- . && git clean -fd .changeset')
  }

  // ── 打标前门禁 ──────────────────────────────────────────────────────────
  await runReleaseGates(ui, tag, options.skipGates)

  if (tagExistsLocally(tag)) {
    // 「本地已有这个 tag」不等于「它是上次运行打在 HEAD 上的」：别人的 tag / 早先失败的运行 /
    // 被 amend 过的提交都会让它指向**别的 commit**，而 push 出去的就是那个 commit（不可回退）。
    const pointed = tagCommit(tag)
    const head = headCommit()
    if (!pointed || !head || pointed !== head) {
      ui.die(1, `标签 ${tag} 已存在，但它指向 ${pointed?.slice(0, 12) ?? '(读不到)'}，而 HEAD 是 ${head?.slice(0, 12) ?? '(读不到)'}。\n`
      + `   推它等于把一个**别的 commit** 发布成 ${tag}。请先查清这个 tag 是谁打的；确认要重打：git tag -d ${tag} 后重跑。`)
    }
    ui.log(`标签 ${tag} 已存在且指向 HEAD，跳过打标`)
  }
  else {
    ui.log(`创建标签: ${tag}`)
    // 跳过门禁要**留在 tag annotation 里**（事后可审计）：tag 是这条发版线的永久凭据，
    // 光在终端打一行警告，几个月后没人说得出「这一版有没有跑门禁」。多条 `-m` 在 git 里是多段正文。
    const skipNote = skipGatesLabel(options.skipGates)
    await runArgs('git', [
      '-C',
      REPO_ROOT,
      'tag',
      '-a',
      assertSafeRef(tag, 'tag 名'),
      '-m',
      tag,
      ...(skipNote === '' ? [] : ['-m', skipNote]),
    ], ui.childOptions())
  }

  if (tagExistsRemotely(tag) && branchIsPushed(branch)) {
    ui.log('分支与标签都已在远端，跳过推送')
    return
  }

  // `--atomic`：分支与 tag 两条 ref **要么一起成功、要么都不动**。没有它时 git 按 ref 独立处理 ——
  // 分支因 non-fast-forward 被拒而 tag 照样落地，远端会留下一个指向未推送提交的 tag。
  ui.log(`推送分支与标签（--atomic）...`)
  await runArgs('git', [
    '-C',
    REPO_ROOT,
    'push',
    '--atomic',
    'origin',
    assertSafeRef(branch, '当前分支名'),
    assertSafeRef(tag, 'tag 名'),
  ], {
    hint: '远端 pre-receive 之前会先跑本仓的 pre-push 门禁（`pnpm --silent prepush`：'
      + 'src/ci/prepush.ts 那张表，11 段并行、每段报耗时），冷缓存数分钟属预期；'
      + '心跳会告诉你是「在跑」还是「卡住了」。',
    ...ui.childOptions(),
  })
}

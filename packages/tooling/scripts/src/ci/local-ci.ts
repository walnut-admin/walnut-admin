/**
 * `pnpm ci:local` —— 把 CI 的**构建类**步骤复刻成一条能在本机跑的命令。
 *
 * ## 它补的是哪条缝
 *
 * `pnpm prepush`（表在 `ci/prepush.ts`）覆盖 CI `quality` job 的**全部静态门禁**，
 * 但它**一条构建都不跑**：server / admin 的产物、产物冒烟、产物去密、文档死链、迁移、worker 冒烟、
 * actionlint —— 这些散在 `ci.yml` 的 build job 与 openapi job 里，本地**没有任何入口**。
 * 于是「构建类的错」只有推上去才发现。真实的代价记在 `ci.yml:274-283`：v0.1.4 的发版死在
 * `Build admin`，而**同一个提交的 CI 是绿的** —— 因为 CI 命中了 turbo 缓存、压根没真构建。
 *
 * ## 顺序即依赖（与 prepush 的并行表相反）
 *
 * prepush 的各段互不牵连，所以并行；这里**必须顺序**：后一步读的是前一步的产物
 * （冒烟读 admin 的 dist、去密扫描读同一份 dist、worker 冒烟读 server 的
 * `dist/apps/worker/src/main.js`）。因此**第一个失败就中止** —— 后面的结论不可信，
 * 继续跑只会把一次失败放大成好几条假红（prepush 头部记过同类的账）。
 *
 * ## 四态不折叠
 *
 * 与 prepush 同一套口径（`lib/errors.ts`）：
 *
 * | 情形 | 抛什么 | 退出码 |
 * |---|---|---|
 * | 每一步都真跑过且通过 | 什么都不抛 | 0 |
 * | 跑过且没过（构建失败 / 断言失败） | `ViolationError` | 1 |
 * | 前置条件不成立（产物不存在、`.data` 被占用） | `PreconditionError` | 2 |
 * | 这一步**压根没跑**（本机没装 actionlint） | `SkippedError` | 3 |
 *
 * 第 3 态是这条命令最容易说谎的地方：本仓没有 actionlint 时，「全绿」实际上只意味着
 * 「除了 workflow 校验，其余都真跑过了」。汇总复用 `ci/prepush.ts` 的 `summarizeRun`，
 * 跳过的那几步**单列**在「未验证的段」一行里 —— 不许读成通过。
 *
 * ## 参数
 *
 * `--only=<id,...>` / `--skip=<id,...>`（调试单步用；未知 id 直接报错，
 * 不静默忽略 —— 拼错一个 id 却「跑完了」，是本仓最忌讳的失败形态）。
 *
 * ## 不做什么
 *
 * 不替代 `pnpm prepush`（静态门禁照样每次 push 都要跑）、不替用户装工具（没装就是没装）、
 * 不写死任何计数（步数以 {@link LOCAL_CI_STEPS} 为准，运行时用 `plan.length` 报数）。
 */

import type { Buffer } from 'node:buffer'
import type { GateResult, GateStatus, PrepushGate } from './prepush.ts'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { ChildRunError, runArgs } from '../lib/child-run.ts'
import { killChildTree, registerChild, unregisterChild } from '../lib/child-tree.ts'
import { PreconditionError, SKIPPED_EXIT_CODE, SkippedError, ViolationError } from '../lib/errors.ts'
import { err, line, out } from '../lib/log.ts'
import { getPnpmBin } from '../lib/pnpm-launcher.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'
import { formatLine, summarizeRun } from './prepush.ts'

const MINUTE = 60_000

/** 一步的表项：稳定标识 + 人话标签 + 「为什么必须在这里跑」 */
interface StepBase {
  /** 稳定标识：`--only=` / `--skip=` 用的就是它（人话标签不进 argv） */
  id: string
  /** 表格里打印的那一列 */
  label: string
  /** 为什么它必须在这一步跑 —— 失败时跟着明细一起回放，也是「凭什么」 */
  why: string
}

/** 经 `pnpm <argv...>` 执行的步骤（与 prepush 的门禁走**同一条**子进程通道） */
export interface PnpmStep extends StepBase {
  /** 命令行（argv 直传，永不 shell） */
  argv: readonly string[]
  /** 这一步的预算（毫秒）：按**实测**量级给；超时归 2（口径见 lib/child-run.ts） */
  budgetMs: number
}

/**
 * 自定义步骤：`worker-smoke` **不是任何 pnpm 脚本**，它要做三件门禁表表达不了的事 ——
 * 轮询子进程 stdout、在命中之后停掉它、比对它有没有碰过 `.data`。
 */
export interface CustomStep extends StepBase {
  run: () => Promise<void>
}

export type LocalCiStep = PnpmStep | CustomStep

/**
 * 本地 CI 的**步骤表**（唯一真源：增删步骤只改这一处，命令行只有 `pnpm ci:local` 一个词）。
 *
 * 顺序 = 依赖顺序，不是「读起来顺」。每一步的 `why` 里写着它对应 `ci.yml` 的哪一段。
 */
export const LOCAL_CI_STEPS: readonly LocalCiStep[] = [
  {
    id: 'build-server',
    label: '构建 server + 共享包（turbo build --filter=@walnut/server...）',
    argv: ['exec', 'turbo', 'run', 'build', '--filter=@walnut/server...'],
    budgetMs: 15 * MINUTE,
    why: '第 1 步是后面所有 server 侧步骤的前提：worker 冒烟读的就是它产出的 '
      + 'apps/server/dist/apps/worker/src/main.js。用 @walnut/server... 形态（含依赖包）而不是只构建 server：'
      + 'contract / utils 的 dist 不进 git、install 也不生成，而 worker / openapi 的运行时都要 require 它们。'
      + ' // LINK .github/workflows/ci.yml:263-264',
  },
  {
    id: 'build-admin',
    label: '构建 admin（turbo build --filter=@walnut/admin --force，不吃缓存）',
    argv: ['exec', 'turbo', 'run', 'build', '--filter=@walnut/admin', '--force'],
    budgetMs: 20 * MINUTE,
    why: '**--force 是刻意的，别去掉**：忽略 turbo 缓存、真的跑一次构建。因为「CI 的绿有可能是缓存给的」，'
      + '而发版是 cache miss ⇒ 真构建 ⇒ 才暴露（2026-09-30 实测：v0.1.4 的发版死在 Build admin，'
      + '同一个提交的 CI 却是绿的）。代价是这一步 2~5 分钟，换来的是本地与 CI / 发版在「构建」这件事上同源。'
      + '注意这里**不**像根脚本 build:admin 那样设 NODE_OPTIONS=--max-old-space-size：'
      + 'CI 用的是裸 pnpm exec turbo，要与它同源就不能在这里偷偷加环境。'
      + ' // LINK .github/workflows/ci.yml:274-286',
  },
  {
    id: 'smoke-dist',
    label: '产物冒烟（真实浏览器打开 dist，断言 splash 消失）',
    argv: ['smoke:dist'],
    budgetMs: 5 * MINUTE,
    why: '构建成功不等于跑得起来（留档 V13）：resolve.conditions 少了默认条件 ⇒ 产物一执行就抛 '
      + 'Cannot destructure property __extends、页面停在 splash —— 而 tsc / lint / build / dist 密钥扫描**全绿**。'
      + '这一步是唯一在运行期看得见它的地方。**没有浏览器时脚本自己 SKIP**（CHROME_PATH 可指定）。'
      + ' // LINK .github/workflows/ci.yml:288-294',
  },
  {
    id: 'lint-dist',
    label: '产物去密体检（扫 dist 有没有把后端 env 打包进去）',
    argv: ['lint:dist'],
    budgetMs: 5 * MINUTE,
    why: '前端产物是**公开文件**，而「把后端 env 泄进前端」在本仓有现成的静默路径：'
      + 'apps/server/env-local 与 apps/admin/env-local 是两套 env，搬错一行就会被打包进去，'
      + '而构建 / 类型 / lint / 测试全都不会响。它扫的就是 dist，所以**必须紧跟构建**'
      + '（没有产物时会以 2 退出）。 // LINK .github/workflows/ci.yml:296-302',
  },
  {
    id: 'build-docs',
    label: '构建文档站（顺带死链门禁）',
    argv: ['build:docs'],
    budgetMs: 10 * MINUTE,
    why: 'VitePress 构建本身就是死链校验（ignoreDeadLinks 已从 true 收窄成白名单，只剩冻结语料）。'
      + '改文档、改包名、改仓库路径都可能把链接改死，而只有构建会报；本地没有这一步时就只能等 CI 的 '
      + 'Docs build。 // LINK .github/workflows/ci.yml:116-129',
  },
  {
    id: 'migration-run',
    label: '对本地库跑迁移（幂等；下一步的 worker 冒烟要一个已迁移的库）',
    argv: ['migration:run'],
    budgetMs: 10 * MINUTE,
    why: 'worker 冒烟要连一个**已迁移**的库（CI 那边是 openapi job 的 service 容器 + 同名命令）。'
      + '迁移是幂等的，重复跑只会报「No migrations are pending」，所以每次推之前跑一遍是安全的。'
      + ' // LINK .github/workflows/ci.yml:388-391',
  },
  {
    id: 'worker-smoke',
    label: 'worker 冒烟（起 worker → 断言 cron 挂上了 → 断言它没碰 .data）',
    run: workerSmoke,
    why: 'worker 的失败是**静默的**：cron 没挂上时 api 照常 200、/health/ready 照过，'
      + '部署脚本与 post-verify 都看不见。唯一现成的探针是 apps/server/apps/worker/src/main.ts 里那行 '
      + 'cron jobs: N，不用改代码。它同时守住第二条不变量：.data/tokensList.json（CAP token 存储）'
      + '在 worker 启停前后必须**逐字节不变** —— 变了就说明 CAP 求值链回到了 worker 闭包里。'
      + ' // LINK .github/workflows/ci.yml:408-475',
  },
  {
    id: 'actionlint',
    label: 'workflow 校验（actionlint，经 pnpm lint:workflows）',
    argv: ['lint:workflows'],
    budgetMs: 5 * MINUTE,
    why: '非法的 workflow 文件**自己不会运行**：GitHub 判 Invalid workflow file 后启动即失败、0 个 job，'
      + '在 Actions 列表里只留一个看起来只是「跑失败了」的红叉（本仓 2026-08-13 到 09-21 就这么静默失效了五周）。'
      + '本机没装 actionlint 时那一步**压根没跑**（SkippedError ⇒ 退出码 3，不是 0）：'
      + '权威闸门是 CI 的 workflow-lint.yml，本地这一步只是提前量。'
      + ' // LINK .github/workflows/workflow-lint.yml:32-38',
  },
]

/** 全表预算的覆盖开关（毫秒；${<= 0} 等于不设上限）。名字与 prepush 的 PREPUSH_BUDGET_MS 分开：两个口径 */
export const LOCAL_CI_BUDGET_ENV = 'CI_LOCAL_BUDGET_MS'

/** worker 入口（相对 apps/server/）：nest build 按 apps/worker/src/main.ts 产出 */
const WORKER_ENTRY = 'dist/apps/worker/src/main.js'

/** CAP token 文件名（在 apps/server/.data/ 下）：worker 只要加载过 cap.js，SIGTERM 时的 cleanup() 就会改写它 */
const CAP_TOKEN_FILE = 'tokensList.json'

/**
 * 种进去的那份**含过期项**的 token 表：expires=1 是 1970 年，必然被判过期。
 *
 * 为什么必须有过期项：@cap.js/server 的 cleanup() 在进程收尾时把**过期项**删掉再整份写回
 * （ci.yml:433-440 的注释）。表里没有过期项时它可能一字不写 —— 那样这道判据就是空转。
 * deadbeef:0123456789abcdef 是形如真实 token 的假值，不需要任何凭据。
 */
const CAP_TOKEN_SEED = '{"deadbeef:0123456789abcdef":1}'

/** mtime 钉到 2020：任何一次 touch / 写回都看得见（对齐 ci.yml:443 的 touch -d 2020-01-01） */
const CAP_TOKEN_MTIME = new Date('2020-01-01T00:00:00Z')

/**
 * 等 cron jobs: N 的上限：180s。**依据是实测，不是拍脑袋。**
 *
 * 两次真实读数（同一台机器，Windows）：单独跑这一步 **6.0s** 命中；完整跑（前面几个构建把
 * 页缓存冲掉之后）**63.3s** 才命中。CI 那边是 40 x 1s（ubuntu 上冷 require 整张依赖图约 9s），
 * 本机冷 require 863 个文件比它慢一个量级 —— 所以**不能把任何一个读数写死**。
 *
 * 取 63.3s 这个**下界**为基线、按本仓「以实测下界为基线留 >=2 倍余量」的口径
 * （同 ci/prepush.ts 的 SLOW_GATE_BUDGET_MS），180s ≈ **2.8x**。别把它拉回 90s：
 * 1.4x 的余量在一台更慢 / 冷缓存的机器上就是随机红，而假红是门禁失效最常见的起点。
 *
 * 按这台机器调就设 {@link WORKER_POLL_TIMEOUT_ENV}（毫秒），不必改代码。
 */
export const WORKER_POLL_TIMEOUT_MS = 180_000

/** 覆盖轮询上限的环境变量名（毫秒）。名字按步骤给，别和 prepush 的 PREPUSH_BUDGET_MS 混用 */
export const WORKER_POLL_TIMEOUT_ENV = 'CI_LOCAL_WORKER_SMOKE_TIMEOUT_MS'

/**
 * 实际生效的轮询上限（毫秒）：{@link WORKER_POLL_TIMEOUT_ENV} 优先，缺省回落到
 * {@link WORKER_POLL_TIMEOUT_MS}。
 *
 * 与 runArgs 的预算**刻意不同**：这里不接受「不设上限」（`<= 0` / 非数字一律当没给）。
 * worker 沉默时没有上限就意味着永久挂着 —— 那不是宽容，那是再加一个没法归因的卡死。
 */
export function workerPollTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env[WORKER_POLL_TIMEOUT_ENV])
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : WORKER_POLL_TIMEOUT_MS
}

/** 轮询间隔（毫秒）。固定 sleep 3 是 ci.yml 注释里明令禁止的写法（慢机器上会随机红） */
export const WORKER_POLL_INTERVAL_MS = 1_000

/** 发 SIGTERM 之后等它自己收尾的上限（Nest 的 enableShutdownHooks 要关 PG / Redis / Bull） */
const WORKER_STOP_TIMEOUT_MS = 15_000

/**
 * 从 worker 日志里取 cron jobs: N 的 N（没有就 null）。
 *
 * 真源是 apps/server/apps/worker/src/main.ts 里那行 logger.log(... cron jobs: N ...) ——
 * 本函数**不去 import 它**（worker 是后端内部的 app，工具链不消费它的源码），只认这一个形态。
 * 取**最后一次**出现：真出现两次时以最后一条为准（比如将来加了一行「收尾时还剩 N 个」）。
 */
export function matchCronJobs(log: string): number | null {
  let jobs: number | null = null
  for (const m of log.matchAll(/cron jobs: (\d+)/g))
    jobs = Number(m[1])
  return jobs
}

/** 一份文件的三个指纹：内容哈希 + 大小 + mtime（只看 mtime 会被「写了但内容相同」骗过去） */
export interface FileSnapshot {
  sha256: string
  size: number
  /** 毫秒时间戳（statSync().mtimeMs 是浮点，原样保留：比的是「有没有被写过」，不是差多少） */
  mtimeMs: number
}

/** 取一份文件的三个指纹 */
export function snapshotFile(file: string): FileSnapshot {
  const stat = statSync(file)
  return {
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}

/** 三个指纹是否逐一相同（mtimeMs 用全等：同一个文件没被写过，读数必然逐位相同） */
export function sameSnapshot(a: FileSnapshot, b: FileSnapshot): boolean {
  return a.sha256 === b.sha256 && a.size === b.size && a.mtimeMs === b.mtimeMs
}

/** 指纹的人话形态（诊断行用；哈希截短到 12 位，够区分又不刷屏） */
export function formatSnapshot(s: FileSnapshot): string {
  return `sha256=${s.sha256.slice(0, 12)}… size=${s.size} mtime=${new Date(s.mtimeMs).toISOString()}`
}

/**
 * 四态退出码 → 本表的三态。**跳过不是通过**：这是整条命令最容易被写错的一行
 * （prepush 的 runGates 里有同一份判断，两处口径必须一致）。
 *
 * 两种跳过来源：自定义步骤直接抛 SkippedError；pnpm 步骤的子进程按四态码报 3
 * （lib/cli.ts 的映射）。其余一律算失败 —— 宁可多报一条红，也不许把没验过说成验过了。
 */
export function stepStatusOf(error: unknown): GateStatus {
  if (error instanceof SkippedError)
    return 'skipped'
  if (error instanceof ChildRunError && error.exitCode === SKIPPED_EXIT_CODE)
    return 'skipped'
  return 'failed'
}

/** 参数解析的结果（only 为 null = 没给 --only，跑整张表） */
export interface SelectionArgs {
  only: string[] | null
  skip: string[]
}

const USAGE = '用法：pnpm ci:local [--only=<id,...>] [--skip=<id,...>]'

/**
 * 只解析 argv，**不认 id 是否真实**（那是 {@link selectSteps} 的事：只有它知道表里有谁）。
 *
 * 刻意只认等号形态（--only=…）：空格形态（--only foo）在 pnpm 转发时容易被吞掉一层，
 * 届时「参数没生效」与「参数生效了但没跑那一步」在输出上无法区分。
 */
export function parseSelectionArgs(argv: readonly string[]): SelectionArgs {
  const only: string[] = []
  let hasOnly = false
  const skip: string[] = []

  for (const arg of argv) {
    const eq = arg.indexOf('=')
    const flag = eq < 0 ? arg : arg.slice(0, eq)
    if (flag !== '--only' && flag !== '--skip')
      throw new PreconditionError(`不认识的参数「${arg}」。${USAGE}`)
    if (eq < 0)
      throw new PreconditionError(`${flag} 要用等号连接取值（形如 ${flag}=a,b）。${USAGE}`)
    const ids = arg.slice(eq + 1).split(',').map(id => id.trim()).filter(id => id !== '')
    if (ids.length === 0)
      throw new PreconditionError(`${flag} 没给 id（形如 ${flag}=a,b）。${USAGE}`)
    if (flag === '--only') {
      hasOnly = true
      only.push(...ids)
    }
    else {
      skip.push(...ids)
    }
  }

  return { only: hasOnly ? only : null, skip }
}

/**
 * 按 argv 从表里挑步骤，**永远保持表里的顺序**（顺序即依赖顺序，命令行给的顺序不作数）。
 *
 * 未知 id 直接抛 PreconditionError（退出码 2）并把表里真实的 id 全列出来 ——
 * 拼错一个 id 却「跑完了」的形态，比跑红危险得多。
 */
export function selectSteps(
  steps: readonly LocalCiStep[],
  argv: readonly string[],
): LocalCiStep[] {
  const { only, skip } = parseSelectionArgs(argv)
  const known = new Set(steps.map(step => step.id))
  const ids = [...new Set([...(only ?? []), ...skip])]
  const unknown = ids.filter(id => !known.has(id))
  if (unknown.length > 0) {
    throw new PreconditionError(
      `未知步骤 id：${unknown.join(', ')}。表里的是：${steps.map(step => step.id).join(', ')}（表在 packages/tooling/scripts/src/ci/local-ci.ts）`,
    )
  }

  const picked = only === null ? steps : steps.filter(step => only.includes(step.id))
  const kept = picked.filter(step => !skip.includes(step.id))
  if (kept.length === 0) {
    throw new PreconditionError(
      `--only / --skip 之后一步都不剩，没有可跑的。表里的是：${steps.map(step => step.id).join(', ')}`,
    )
  }
  return [...kept]
}

/**
 * 跑一步 pnpm 命令。
 *
 * - **cwd 恒为仓库根**：从子目录跑时 pnpm <脚本> 会解析到**最近那个包**的脚本
 *   （于是「根 test」静默缩成单包 test）—— 与 prepush 的同一条理由。
 * - **不缓冲输出**：这里是顺序执行，8~12 分钟的命令必须能看见它在动（prepush 并行才需要缓冲）。
 * - 预算按步给（budgetMs），整台机器都慢时用 {@link LOCAL_CI_BUDGET_ENV} 一处放宽。
 */
async function runPnpmStep(step: PnpmStep, bin: string, index: number, total: number): Promise<void> {
  await runArgs(bin, [...step.argv], {
    cwd: REPO_ROOT,
    hint: `第 ${index}/${total} 步：${step.label}`,
    budgetDefaultMs: step.budgetMs,
    budgetEnv: LOCAL_CI_BUDGET_ENV,
  })
}

/** 秒级 sleep（轮询用） */
function sleep(ms: number): Promise<void> {
  return new Promise(done => setTimeout(done, ms))
}

/**
 * 挪一个目录（备份 / 恢复 .data 用）。
 *
 * 先 rename（同一卷内是原子的，且 mtime / 权限一并保住）；跨卷时 Node 抛 EXDEV，
 * 退回复制 + 删除（Windows 上仓库在 D:、临时目录在 C:，这条分支**每天都会走**）。
 * 其余失败（EBUSY / EPERM）几乎只有一个原因：本地的 api / worker 进程还占着 .data
 * —— 那是**前置条件**（先停进程），不是脚本自己的 bug。
 */
function moveDir(from: string, to: string): void {
  try {
    renameSync(from, to)
    return
  }
  catch (error) {
    if ((error as { code?: unknown }).code !== 'EXDEV') {
      throw new PreconditionError(
        `挪动 ${from} 失败（${String((error as { code?: unknown }).code)}）：先停掉占用它的进程（本地的 api / worker）再重跑`,
      )
    }
  }
  cpSync(from, to, { recursive: true, preserveTimestamps: true })
  rmSync(from, { recursive: true, force: true })
}

/**
 * worker 冒烟（复刻 ci.yml:408-475，跨平台）。
 *
 * 三条判据（顺序就是 CI 里的顺序）：
 * 1. 日志里出现 cron jobs: N 且 **N >= 1** —— cron jobs: 0 必须判红：
 *    「进程起来了但一个 cron 都没挂」正是这一步要抓的形态；
 * 2. .data/tokensList.json 的 **sha256 + size + mtime 三个值全未变** ——
 *    变了说明 CAP 求值链回到了 worker 闭包里（@cap.js/server 的 cleanup() 会删过期项并写回）；
 * 3. 前置条件：dist/apps/worker/src/main.js 必须在（第 1 步的产物），否则归 2 而不是 1。
 *
 * NODE_ENV=development 不是随手写的：production 下「开发引导密码」守卫会**直接拒绝启动**
 * （libs/config 的 pg-app-password 守卫，与 openapi:export 同口径）。
 * WALNUT_ADMIN_BOOTSTRAP_TASKS=off 只隔离 bootstrap（否则启动即跑若干含 rotateAppKey 的副作用任务），
 * **不影响 cron 注册** —— 所以计数断言依旧有效（ADR 0025）。
 *
 * 收尾：本机 .data 可能有**真实内容**，所以整目录先挪走、跑完原样挪回；
 * 中途抛异常也照样恢复（finally）。
 */
async function workerSmoke(): Promise<void> {
  const serverDir = join(REPO_ROOT, 'apps/server')
  const entry = join(serverDir, WORKER_ENTRY)

  // 前置条件：这一步**没跑**（产物不存在）与「跑了但 worker 起不来」是两回事，前者归 2
  if (!existsSync(entry)) {
    throw new PreconditionError(
      `找不到 worker 产物 apps/server/${WORKER_ENTRY} —— 先跑 pnpm ci:local --only=build-server（或 pnpm build:server）`,
    )
  }

  const dataDir = join(serverDir, '.data')
  const tokenFile = join(dataDir, CAP_TOKEN_FILE)
  const backupDir = mkdtempSync(join(tmpdir(), 'walnut-ci-local-data-'))
  const backupData = join(backupDir, 'data')
  const hadData = existsSync(dataDir)

  if (hadData) {
    out(`  本机已有 apps/server/.data（真实内容）⇒ 先整目录备份到 ${backupDir}，跑完恢复`)
    moveDir(dataDir, backupData)
  }

  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(tokenFile, CAP_TOKEN_SEED, 'utf8')
    utimesSync(tokenFile, CAP_TOKEN_MTIME, CAP_TOKEN_MTIME)
    const before = snapshotFile(tokenFile)
    out(`  种入含过期项的 CAP token 表：${formatSnapshot(before)}`)

    // ---- 起 worker（stdio 走管道：要轮询 stdout；stderr 也留进同一份日志便于归因）----
    const child = spawn(process.execPath, [entry], {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        WORKER_STANDALONE: 'true',
        WALNUT_ADMIN_BOOTSTRAP_TASKS: 'off',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // 只隐藏窗口：Windows 上 detached: true 会给子进程分配独立控制台，无控制台的宿主里启动即报 ERROR_NO_DATA
      windowsHide: process.platform === 'win32',
    })
    registerChild(child)

    let log = ''
    let alive = true
    let exitInfo: string | null = null
    const closed = new Promise<void>((resolve) => {
      child.once('close', (code, signal) => {
        alive = false
        exitInfo = code === null ? `被信号 ${signal ?? '?'} 结束` : `退出码 ${code}`
        unregisterChild(child)
        resolve()
      })
      // spawn 自身失败（入口被删 / 平台不允许）：同样算「进程没了」，让轮询立刻收敛
      child.once('error', (error) => {
        alive = false
        exitInfo = `启动失败：${error.message}`
        unregisterChild(child)
        resolve()
      })
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      log += text
      out(text.trimEnd())
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      log += text
      err(text.trimEnd())
    })

    try {
      // ---- 轮询：命中即走（1s 一问，上限见 WORKER_POLL_TIMEOUT_MS）；进程提前死掉也立刻收敛 ----
      const pollStart = Date.now()
      const pollTimeoutMs = workerPollTimeoutMs()
      let cronJobs = matchCronJobs(log)
      // 用 for (;;) + 显式 break 而不是 while (三个条件)：`alive` 由 close 回调改（这个循环看不见），
      // 写成循环条件会被 no-unmodified-loop-condition 判成「永远不会退出」。
      for (;;) {
        if (cronJobs !== null || !alive || Date.now() - pollStart >= pollTimeoutMs)
          break
        await sleep(WORKER_POLL_INTERVAL_MS)
        cronJobs = matchCronJobs(log)
      }
      const waited = ((Date.now() - pollStart) / 1000).toFixed(1)
      const probe = cronJobs === null
        ? (alive ? '没等到 cron jobs: N（进程仍在，超时）' : '没等到 cron jobs: N（进程已退出）')
        : `cron jobs: ${cronJobs}`
      out(`  ${waited}s 后：${probe}`)

      // ---- 收尾：SIGTERM + 等退出（Windows 上 Node 的 child.kill 是直接终止，可接受）----
      if (alive) {
        out('  发 SIGTERM 停掉 worker（Nest 的 enableShutdownHooks 会自己收 PG / Redis / Bull）')
        child.kill('SIGTERM')
        const stopped = await Promise.race([
          closed.then(() => true),
          sleep(WORKER_STOP_TIMEOUT_MS).then(() => false),
        ])
        if (!stopped) {
          // 它不自己走：收**这一棵**进程树（别用 killActiveChild —— 那会把无关的进程一起收）
          err(`  ${WORKER_STOP_TIMEOUT_MS / 1000}s 内没退出，收掉进程树`)
          killChildTree(child)
          await Promise.race([closed, sleep(5_000)])
        }
      }

      // ---- 断言 1：cron jobs: N，N >= 1 ----
      // 诊断块用数组拼行：跨行模板里既有拼接又有缩进，会被 style/indent-binary-ops 与 prefer-template 判红
      const tail = ['日志尾部：', ...log.trimEnd().split('\n').slice(-5).map(item => `  | ${item}`)].join('\n')
      if (cronJobs === null) {
        const exit = exitInfo === null ? '' : `（${exitInfo}）`
        throw new ViolationError([
          `worker 日志里没出现 cron jobs: N${exit} —— 进程没走到「注册完 cron」那一步。`,
          '若是连不上 PG / Redis，先起库再重跑（那不是代码问题）。',
          tail,
        ].join('\n'))
      }
      if (cronJobs < 1) {
        throw new ViolationError([
          'cron jobs: 0 —— 进程起来了，但一个 cron 都没挂上（ci.yml:459-461 明令这一步必须判红）。',
          'WorkerModule 必须保证注册过 ScheduleModule，且 cron 装饰器所在的模块进了 imports。',
          tail,
        ].join('\n'))
      }
      out(`  断言通过：cron jobs: ${cronJobs}（>= 1）`)

      // ---- 断言 2：CAP token 存储三个值全未变 ----
      const after = snapshotFile(tokenFile)
      out(`  worker 停掉之后：${formatSnapshot(after)}`)

      if (!sameSnapshot(before, after)) {
        throw new ViolationError([
          'worker 触碰了 CAP token 存储（apps/server/.data/tokensList.json）—— CAP 求值链回到了 worker 闭包里。',
          `  before: ${formatSnapshot(before)}`,
          `  after : ${formatSnapshot(after)}`,
          `  现在的内容：${readFileSync(tokenFile, 'utf8').slice(0, 200)}`,
        ].join('\n'))
      }
      out('  OK: worker 没有触碰 .data/tokensList.json（CAP 求值链不在 worker 闭包里）')
    }
    finally {
      // 兜底收尾：任何一条路径上都不许留下一个还在跑的 worker（它会继续写 .data，并把恢复搞乱）
      if (alive) {
        child.kill('SIGTERM')
        await Promise.race([closed, sleep(5_000)])
      }
      if (alive)
        killChildTree(child)
      unregisterChild(child)
    }
  }
  finally {
    // 恢复现场：删掉我们造的那份 .data，把备份原样挪回去。**异常路径同样执行**
    rmSync(dataDir, { recursive: true, force: true })
    if (hadData) {
      moveDir(backupData, dataDir)
      out('  已恢复原来的 apps/server/.data')
    }
    rmSync(backupDir, { recursive: true, force: true })
  }
}

/**
 * 把一步投影成 GateResult.gate —— 只为**复用** prepush 的 formatLine / summarizeRun
 * （它们只读 id / label；argv 是 prepush 执行器用的，自定义步骤这里给空数组）。
 */
function gateOf(step: LocalCiStep): PrepushGate {
  return {
    id: step.id,
    label: step.label,
    argv: 'argv' in step ? [...step.argv] : [],
    why: step.why,
  }
}

/**
 * 失败的步骤该以**哪一种**四态码收场。
 *
 * 三个都要保住：PreconditionError（2：先修环境）、ViolationError（1：改代码）、
 * SkippedError（3：没验过）。子进程的 ChildRunError 要**翻译**：它的 exitCode 是子进程的退出码，
 * 其中 2 恰好也是「前置条件未满足」（如 smoke:dist 没有产物时退出 2）⇒ 归 2；
 * 其余按违规处理，否则「修环境」会被说成「改代码」。
 */
export function failureToError(failure: unknown): Error {
  if (failure instanceof PreconditionError || failure instanceof ViolationError || failure instanceof SkippedError)
    return failure
  if (failure instanceof ChildRunError) {
    const message = failure.message
    return failure.exitCode === 2 ? new PreconditionError(message) : new ViolationError(message)
  }
  return new ViolationError(failure instanceof Error ? failure.message : String(failure))
}

/**
 * 「跳过」时的**汇总 + 怎么修**（两行）：第一行是 summarizeRun 的结论，第二行告诉人接下来做什么。
 *
 * 为什么必须多这一行：退出码 3 加上「未验证的段」很容易被读成「我自己跑挂了」。真正的原因往往只有
 * 一个（工具没装），修法也就一条命令 —— 但没人愿意为一个本机环境问题去翻源码。这里**指向文档**
 * 而不是在 CLI 里抄三种装法：抄一份就多一份会腐烂的命令（装法本身会变，文档改一处就够）。
 */
export function skippedHint(skippedLine: string): string {
  const hint = '  提示：跳过不等于通过。actionlint 未安装时就是这一段没跑 —— 装法（Windows / macOS / Linux 各一条）见 docs 的「本地复刻 CI」小节：apps/docs/src/zh-CN/content/monorepo/ci-cd.md'
  return [skippedLine, hint].join('\n')
}

/** pnpm 可执行文件**惰性**取一次（`--only=worker-smoke` 时根本用不到，不该为此摸盘） */
let pnpmBinOnce: string | undefined
function pnpmBin(): string {
  pnpmBinOnce ??= getPnpmBin()
  return pnpmBinOnce
}

export async function main(): Promise<void> {
  const plan = selectSteps(LOCAL_CI_STEPS, process.argv.slice(2))
  const startedAt = Date.now()
  out(`本地复刻 CI：${plan.length} 步，**顺序**执行（表在 packages/tooling/scripts/src/ci/local-ci.ts）`)
  out('  与 prepush 的分工：那边跑静态门禁（必跑、快），这边跑构建类（推之前跑一次）；两边没有重叠。')

  const results: GateResult[] = []
  let failure: unknown = null

  for (const [index, step] of plan.entries()) {
    out(`
${index + 1}/${plan.length} ${step.label}`)
    const stepStart = Date.now()
    let status: GateStatus = 'ok'
    let error: unknown = null
    try {
      if ('run' in step)
        await step.run()
      else
        await runPnpmStep(step, pnpmBin(), index + 1, plan.length)
    }
    catch (caught) {
      // 四态在这里收敛成三态（跳过 / 失败），最终的退出码由 runCli 一处映射
      error = caught
      status = stepStatusOf(caught)
    }
    const result: GateResult = {
      gate: gateOf(step),
      status,
      ms: Date.now() - stepStart,
      output: error === null ? '' : (error instanceof Error ? error.message : String(error)),
    }
    results.push(result)
    out(formatLine(result))
    if (status === 'failed') {
      failure = error
      break
    }
  }

  const total = ((Date.now() - startedAt) / 1000).toFixed(1)
  const summary = summarizeRun(results, total, false)
  const unrun = plan.slice(results.length).map(step => step.id)

  if (summary.failed.length === 0) {
    line('ok', summary.okLine)
    // 有跳过时**不许**以 0 退出：SkippedError ⇒ 3，「没验过」在机器眼里必须区别于「通过」。
    // 那一行汇总（段名 + 「跳过不等于通过」+ 权威闸门指向）由 summarizeRun 给，别在这里另写一句。
    if (summary.skippedLine !== null)
      throw new SkippedError(skippedHint(summary.skippedLine))
    return
  }

  // 失败才回放：成功时那些输出没人看，失败时它是唯一线索（与 prepush 同一形态）
  const rule = '─'.repeat(20)
  for (const result of summary.failed) {
    err(`
${rule} ${result.gate.label} 失败（${(result.ms / 1000).toFixed(1)}s） ${rule}`)
    err(`为什么必须有这一步：${result.gate.why}`)
    err(result.output.trimEnd() || '（这一步没有输出，只有非零退出码）')
  }
  err(`${summary.failed.length}/${results.length} 步失败：${summary.failed.map(item => item.gate.id).join(', ')}（总 ${total}s）`)
  if (unrun.length > 0) {
    err(`后续 ${unrun.length} 步**未执行**（顺序即依赖：前一步没过时，后面的结论不可信）：${unrun.join(', ')}`)
  }
  // 已经有失败时结论早就红了，但「还有几步没验过」仍要说
  if (summary.skippedLine !== null)
    err(summary.skippedLine)

  throw failureToError(failure)
}

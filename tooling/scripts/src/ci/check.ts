/**
 * `pnpm check`（bin `walnut-check`）—— 「本地完整检查」的组合入口。
 *
 * ## 它补的是哪条缝
 *
 * `pnpm lint` 只是 **ESLint 一条轨**（turbo run lint）；`lint:oxlint` 与 `format:check` 是命令表
 * 里另外两条，`types:check` / `test` 又各自是根脚本。于是「本地全绿」没有一个可执行的名字：
 * 人要么记一串命令，要么直接跳到 `pnpm prepush`（还把架构边界、依赖一致性、锁步一起带上）。
 * 这条命令把**静态检查的完整面**拼成一条，判据是「等价于 prepush 的静态面，但不含架构边界 /
 * 依赖一致性 / 发版记账」。
 *
 * ## 为什么不是一个 shell 串
 *
 * 根 `package.json` 的脚本值不许出现 `&&` / `;` / `|`（`gate-wiring.test.ts` 机械拦：那会让
 * 「一句话委托」退化成没人审计的 shell 单行）。所以组合写成 bin：根脚本只有 `walnut-check` 一个词，
 * 步骤表在本文件，每步的 argv 写在**命令表 id / 可执行名字**上，由 `resolveCommandArgv` 解析。
 *
 * ## 顺序即执行顺序（第一个失败即止）
 *
 * 与 `prepush` 的并行表相反，这里刻意串行：三段都要抢 CPU 与磁盘缓存，串行下每一步的耗时读数
 * 才是干净的；同时「第一个失败就停」让人先修最上游那条（lint 红了还跑 types / test 没有意义）。
 *
 * ## 预算
 *
 * 缺省 30 分钟一步（冷缓存下 `turbo run lint types:check test` 是分钟级），由 `CHECK_BUDGET_MS`
 * 覆盖。不设「入口级」预算：walnut 入口看到 `budgetMs: 0` 就不套全局上限（见命令表那条）。
 */

import { ChildRunError, runArgs } from '../lib/child-run.ts'
import { resolveCommandArgv } from '../lib/commands.ts'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { out } from '../lib/log.ts'
import { getPnpmBin } from '../lib/pnpm-launcher.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** 单步缺省预算：30 分钟（冷缓存下 turbo 三段加起来是分钟级；只作兜底，不作判据） */
const CHECK_BUDGET_MS = 30 * 60_000

/** 覆盖单步预算的环境变量名 */
export const CHECK_BUDGET_ENV = 'CHECK_BUDGET_MS'

export interface CheckStep {
  /** 短 id（报错与跳过后的回放用） */
  id: string
  /** 这一步在干什么（打印给人看） */
  label: string
  /** 写在可执行名字上的 argv（`lint:oxlint` 这类命令表 id 由 resolveCommandArgv 解析） */
  argv: readonly string[]
}

/**
 * 步骤表 —— **顺序即执行顺序**，第一个失败即止。
 *
 * 为什么 `turbo run lint types:check test` 合成一条 `exec turbo` 而不是三段 `run <id>`：
 * 一次 turbo 进程同时建三张任务图，少两次启动与两次缓存索引；三段任务的覆盖面与
 * `pnpm lint` / `pnpm types:check` / `pnpm test` 完全相同。
 */
export const CHECK_STEPS: readonly CheckStep[] = [
  {
    id: 'turbo',
    label: 'ESLint 轨 + 类型检查 + 测试（turbo run lint types:check test）',
    argv: ['exec', 'turbo', 'run', 'lint', 'types:check', 'test'],
  },
  {
    id: 'oxlint',
    label: 'oxlint 快速通道（categories.correctness 兜底）',
    argv: ['lint:oxlint'],
  },
  {
    id: 'format',
    label: '格式检查（oxfmt --check，唯一真源）',
    argv: ['format:check'],
  },
]

/**
 * 跑完整检查。
 *
 * 失败口径：子进程非零 / 超时 → `ChildRunError`（`exitCode` 1）；本机没有 pnpm → `PreconditionError`。
 * 前者是「检出问题」，后者是「环境没准备好」，与 prepush 同一套四态口径（见 `lib/errors.ts`）。
 */
export async function main(): Promise<void> {
  let bin: string
  try {
    bin = getPnpmBin()
  } catch (error) {
    throw new PreconditionError(
      `找不到 pnpm 可执行文件：${error instanceof Error ? error.message : String(error)}`,
    )
  }

  for (const [index, step] of CHECK_STEPS.entries()) {
    out(`第 ${index + 1}/${CHECK_STEPS.length} 步：${step.label}`)
    try {
      await runArgs(bin, resolveCommandArgv(step.argv), {
        cwd: REPO_ROOT,
        budgetDefaultMs: CHECK_BUDGET_MS,
        budgetEnv: CHECK_BUDGET_ENV,
      })
    } catch (error) {
      if (error instanceof ChildRunError) {
        throw new ViolationError(`第 ${index + 1} 步失败（${step.id}）：${error.message}`)
      }
      throw error
    }
  }

  out(`\n${CHECK_STEPS.length} 步全部通过。`)
}

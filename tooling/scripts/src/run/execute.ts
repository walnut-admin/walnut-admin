/**
 * `pnpm walnut` 的执行面：按表顺序跑命令、逐条报结果、收尾给结论。
 *
 * ## 三态不折叠（与 prepush / ci:local 同一套口径）
 *
 * | 情形 | 入口怎么了结 | 退出码 |
 * |---|---|---|
 * | 每条命令都真跑过且通过 | 正常返回 | 0 |
 * | 有命令跑过且没过 | 抛 `failureToError(第一个失败)` | 1 / 2 |
 * | 无失败但有跳过（子进程退出码 3 或 `SkippedError`） | 抛 `SkippedError` | 3 |
 *
 * 判定**直接复用** `ci/local-ci.ts` 的 `stepStatusOf`（跳过 vs 失败）与 `failureToError`
 * （失败的异常形态），汇总与结果行复用 `ci/prepush.ts` 的 `summarizeRun` / `formatLine` ——
 * 同一件事不写第二套口径。所以「子进程退出 2」在这里仍是**前置条件未满足**（退出码 2），
 * 不是笼统的 1：那是全仓一致的「先修环境」信号。
 *
 * ## 一条失败不中断
 *
 * 与 `ci:local` 相反：那边的步骤有依赖（后一步读前一步的产物），第一个失败就中止；
 * 这里的命令**互不依赖**（用户自己挑的），一条红了不该把其余几条的结论一起坑掉 ——
 * 全部跑完再回放失败明细，一次看全。
 *
 * ## 为什么转播而不是缓冲
 *
 * 子进程的输出**实时**出去，不在成功时吞掉。CI 的每个步骤都是 `pnpm walnut <id>`，日志里要看得见
 * 门禁自己打的证据 —— 扫描面有多大、actionlint 是哪个版本、行为测试通过了多少条 ——
 * 缓冲之后这些只剩一行「通过」，排查与审计都少了依据。入口是**顺序**执行的，不存在多路输出
 * 交织的问题（并行跑的 prepush 才需要先缓冲）。失败时 `runArgs` 的报错消息自带输出尾部，
 * `result.output` 只存这条报错，收尾的回放靠它。
 *
 * ## 可注入执行器
 *
 * {@link runTable} 接受 `execute`，用例因此能在**不真起 pnpm** 的前提下覆盖三种结局
 * （写法同 `ci/__tests__/prepush.test.ts`）。
 */

import type { GateResult, GateStatus, PrepushGate } from '../ci/prepush.ts'
import type { Command } from '../lib/commands.ts'
import { failureToError, stepStatusOf } from '../ci/local-ci.ts'
import { formatLine, summarizeRun } from '../ci/prepush.ts'
import { runArgs } from '../lib/child-run.ts'
import { SkippedError, ViolationError } from '../lib/errors.ts'
import { err, line, out } from '../lib/log.ts'
import { getPnpmBin } from '../lib/pnpm-launcher.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/**
 * 覆盖预算的环境变量名（毫秒；`<= 0` = 不设上限）。
 *
 * 与 `PREPUSH_BUDGET_MS` / `CI_LOCAL_BUDGET_MS` 分开：三个号的语义不同（门禁单段 / 本地 CI 全表 /
 * 入口逐条），混用一个会让「我在 CI 上放宽一次」顺带改掉别的命令的超时。
 */
export const RUN_BUDGET_ENV = 'WALNUT_RUN_BUDGET_MS'

/** 一条命令的执行出口：抛异常 = 没通过（`ChildRunError.exitCode` 区分 3 = 未验证） */
export type CommandExecutor = (
  command: Command,
  args: readonly string[],
  write: (text: string) => void,
) => Promise<void>

export interface CommandExecutorOptions {
  /**
   * 覆盖可执行文件（缺省 {@link getPnpmBin} 找到的那个 pnpm）。
   *
   * 用例注入 `process.execPath` 之后，一条「pnpm 命令」就是毫秒级的 `node -e`，
   * 生产路径（cwd / 预算 / 三态归类）一行不改。
   */
  bin?: string
  /**
   * 子进程输出口。**不给就是实时转播**（子进程的 stdout 进 stdout、stderr 进 stderr，由 `runArgs` 缺省接管）。
   * 只为用例保留：要断言子进程输出时接一个收集器。
   */
  output?: { write: (text: string) => void }
}

/**
 * 缺省执行出口：argv 形态经 `pnpm <argv…>` 跑，自定义形态直接调它的 `run`。
 *
 * - **cwd 恒为仓库根**：从子目录跑时 `pnpm <脚本>` 会解析到最近那个包的脚本。
 * - **预算**：命令表里的 `budgetMs` 优先；缺省交给 `lib/child-run.ts` 的默认预算。
 * - **输出实时转播**（见文件头「为什么转播而不是缓冲」）。
 * - pnpm 的路径**惰性**取一次：只选中自定义命令（如 `ci:local`）时根本用不到，不该为此摸盘。
 *
 * 第三个参数 `write` 是给**注入的执行器**回放输出用的（见 `runCommands`）；本执行器不往里写 ——
 * 子进程输出已经实时出去了，再往里写一遍只会在失败回放时重复。
 */
export function createPnpmCommandExecutor(options: CommandExecutorOptions = {}): CommandExecutor {
  let bin: string | undefined = options.bin
  const binOf = (): string => {
    bin ??= getPnpmBin()
    return bin
  }
  return async (command, args) => {
    if ('run' in command) {
      await command.run(args)
      return
    }
    await runArgs(binOf(), [...command.argv, ...args], {
      cwd: REPO_ROOT,
      hint: command.label,
      output: options.output,
      budgetDefaultMs: command.budgetMs,
      budgetEnv: RUN_BUDGET_ENV,
    })
  }
}

/**
 * 把一条命令投影成 `GateResult.gate` —— 只为**复用** prepush 的 `formatLine` / `summarizeRun`
 * （它们只读 id / label / why；argv 是 prepush 执行器用的，自定义命令这里给空数组）。
 */
export function gateOf(command: Command): PrepushGate {
  return {
    id: command.id,
    label: command.label,
    argv: 'argv' in command ? [...command.argv] : [],
    why: command.why,
  }
}

export interface RunCommandsOptions {
  /** 透传给每条命令的参数（只可能来自「恰好一条命令」的选择） */
  passthrough?: readonly string[]
  execute?: CommandExecutor
  /** 一条命令开始前的回调（生产路径打印「序号 / 总数 + label」） */
  onStart?: (position: number, total: number, command: Command) => void
  /** 一条命令结束后的回调（生产路径打印结果行） */
  onDone?: (result: GateResult) => void
}

export interface RunCommandsOutcome {
  results: GateResult[]
  /** 按表顺序的**第一个**失败（原始异常）；没有失败时为 undefined */
  firstFailure: unknown
}

/**
 * 按给定顺序跑命令。**不抛**执行错误（只把它们记进结果）—— 一条失败不中断其余几条，
 * 结局判定留给 {@link runTable} 一处。
 */
export async function runCommands(
  commands: readonly Command[],
  options: RunCommandsOptions = {},
): Promise<RunCommandsOutcome> {
  const { passthrough = [], execute = createPnpmCommandExecutor(), onStart, onDone } = options
  const results: GateResult[] = []
  let firstFailure: unknown

  for (const [index, command] of commands.entries()) {
    onStart?.(index + 1, commands.length, command)
    const started = Date.now()
    const chunks: string[] = []
    let status: GateStatus = 'ok'
    let error: unknown = null
    try {
      await execute(command, passthrough, text => chunks.push(text))
    }
    catch (caught) {
      error = caught
      // 三态收敛的唯一入口（与 ci:local 同一条判断）：只有 SkippedError / 子进程退出 3 算跳过
      status = stepStatusOf(caught)
      chunks.push(error instanceof Error ? error.message : String(error))
    }
    const result: GateResult = {
      gate: gateOf(command),
      status,
      ms: Date.now() - started,
      output: chunks.join(''),
    }
    results.push(result)
    if (status === 'failed' && firstFailure === undefined)
      firstFailure = error
    onDone?.(result)
  }

  return { results, firstFailure }
}

/**
 * 执行 + 收尾：按表顺序跑完、打结果行、给汇总，然后按三态抛错（口径见文件头）。
 *
 * 失败明细**全部跑完之后**才回放（成功时那些输出没人看，失败时它是唯一线索）。
 */
export async function runTable(
  commands: readonly Command[],
  options: RunCommandsOptions = {},
): Promise<void> {
  const startedAt = Date.now()
  out(`walnut：${commands.length} 条命令，按表里的顺序执行（表在 tooling/scripts/src/lib/commands.ts）`)

  const { results, firstFailure } = await runCommands(commands, {
    ...options,
    onStart: (position, total, command) => {
      out(`\n${position}/${total} ${command.label}`)
      options.onStart?.(position, total, command)
    },
    onDone: (result) => {
      out(formatLine(result))
      options.onDone?.(result)
    },
  })

  const total = ((Date.now() - startedAt) / 1000).toFixed(1)
  const summary = summarizeRun(results, total, false)

  if (summary.failed.length === 0) {
    line('ok', summary.okLine)
    // 有跳过时**不许**以 0 退出：SkippedError ⇒ 3，「没验过」在机器眼里必须区别于「通过」。
    // 那一行汇总（段名 + 「跳过不等于通过」）由 summarizeRun 给，别在这里另写一句。
    if (summary.skippedLine !== null)
      throw new SkippedError(summary.skippedLine)
    return
  }

  const rule = '─'.repeat(20)
  for (const result of summary.failed) {
    err(`\n${rule} ${result.gate.label} 失败（${(result.ms / 1000).toFixed(1)}s） ${rule}`)
    err(`为什么必须有这一条：${result.gate.why}`)
    err(result.output.trimEnd() || '（这条命令没有输出，只有非零退出码）')
  }
  err(`${summary.failed.length}/${results.length} 条命令失败：${summary.failed.map(result => result.gate.id).join(', ')}（总 ${total}s）`)
  // 已经有失败时结论早就红了，但「还有几条没验过」仍要说
  if (summary.skippedLine !== null)
    err(summary.skippedLine)

  // 失败的异常形态与 ci:local 同一套：子进程退出 2 / 超时 ⇒ 前置条件未满足（2），
  // 其余 ⇒ 违规（1）。多条约失败时以**表顺序的第一个**为准 —— 先修它。
  throw firstFailure === undefined
    ? new ViolationError(`${summary.failed.length} 条命令失败（明细见上）`)
    : failureToError(firstFailure)
}

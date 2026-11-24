/**
 * `pnpm walnut` 的入口主体（只做拼装：解析 → 分派 → 执行）。
 *
 * ## 命令行契约
 *
 * - `pnpm walnut <id> [<id>…]`：按**表里的顺序**执行选中的命令（不看命令行给的先后）。
 * - `--list`：每行一条「id、分组、说明」，顺序与表一致。
 * - `--json`：整张表的机器可读形态。
 * - `--dry-run`：只打印每条命令将要执行的命令行，不执行。
 * - `--help`：打印用法。
 *   以上四个是入口自己的选项，**只认第一个 id 之前的**；id 之后以 `-` 开头的词属于那条命令。
 * - `--` 之后、或**单条命令后面**的旗标透传给命令（只允许选中一条命令）。非旗标的词只有那条命令
 *   在表里声明了 `positionalArgs` 才算它的位置参数，否则按未知 id 报错（理由见 `args.ts` 头注释）。
 * - 没有给 id 且标准输入是终端：进多选（上下键移动、空格勾选、回车执行）。
 *   取消与空选都**正常返回**（退出码 0）—— 它们什么都没跑，不是失败。
 * - 没有给 id 且标准输入不是终端（CI / pre-push / `| tee`）：打印用法与清单，然后以
 *   「前置条件未满足」（退出码 2）结束。**非交互的调用方绝不停在界面上**（`lib/prompt.ts`
 *   头注释里那条硬契约：停在界面上表现出来是「卡死」而不是「失败」）。
 * - `--dry-run` 不带 id：不探测 TTY，仍按上一条处理 —— dry-run 的语义是「只打印」。
 *
 * 退出码由 `runCli` 统一映射（见 `lib/cli.ts`）：解析错误与未选命令是 2，
 * 执行失败按 `failureToError` 的口径（1 / 2），只有跳过是 3。
 *
 * ## 注入点
 *
 * {@link main} 的第二个参数只在「没有给 id」那一个分支上生效（终端判定、挑选函数与执行出口）。
 * 生产路径全用缺省值；用例靠它覆盖取消 / 空选 / 选中 / 非终端四种结局，而不用真起界面、
 * 也不真起 pnpm。
 */

import type { CommandExecutor } from './execute.ts'
import type { ChooseOutcome, CommandPicker } from './select.ts'
import process from 'node:process'
import { COMMANDS } from '../lib/commands.ts'
import { PreconditionError } from '../lib/errors.ts'
import { out } from '../lib/log.ts'
import { isInteractive } from '../lib/prompt.ts'
import { parseRunArgs, selectCommands, usageText } from './args.ts'
import { pickCommandIds } from './clack.ts'
import { runTable } from './execute.ts'
import { renderDryRun, renderJson, renderList } from './render.ts'
import { chooseCommands } from './select.ts'

/** 用例注入点（生产路径不给） */
export interface MainDeps {
  /** 终端判定（缺省 `lib/prompt.ts` 的 `isInteractive`） */
  isInteractive?: () => boolean
  /** 挑选函数（缺省 `run/clack.ts` 里那份真起界面的） */
  picker?: CommandPicker
  /** 执行出口（缺省经 pnpm 跑；用例注入假执行器） */
  execute?: CommandExecutor
}

export async function main(argv: readonly string[] = process.argv.slice(2), deps: MainDeps = {}): Promise<void> {
  const parsed = parseRunArgs(argv, COMMANDS)

  if (parsed.mode === 'help') {
    out(usageText())
    return
  }
  if (parsed.mode === 'list') {
    out(renderList(COMMANDS))
    return
  }
  if (parsed.mode === 'json') {
    out(renderJson(COMMANDS))
    return
  }

  const selected = selectCommands(COMMANDS, parsed.ids)

  // 一个 id 都没给：终端里进多选；不是终端就落到下面「打印用法与清单 + 前置条件错误」。
  // `--dry-run` 不带 id 时不进多选（不探测 TTY）：dry-run 的语义是「只打印将要执行什么」。
  if (parsed.ids.length === 0 && !parsed.dryRun) {
    const outcome: ChooseOutcome = await chooseCommands(COMMANDS, {
      isInteractive: deps.isInteractive ?? isInteractive,
      picker: deps.picker ?? pickCommandIds,
    })
    if (outcome.kind === 'picked') {
      // 多选不可能带透传参数（没有 id 时解析器不会产生 passthrough），照传只是为了口径一致
      await runTable(outcome.commands, { passthrough: parsed.passthrough, execute: deps.execute })
      return
    }
    if (outcome.kind === 'cancelled') {
      out('已取消，什么都没跑')
      return
    }
    if (outcome.kind === 'empty') {
      out('没有选中任何命令，什么都没跑')
      return
    }
    // non-interactive：继续走下面的老行为
  }

  if (selected.length === 0) {
    out(usageText())
    out(renderList(COMMANDS))
    throw new PreconditionError('没有选中任何命令：给至少一个 id（清单见上），或用 --list 查看全部。')
  }

  if (parsed.dryRun) {
    out(renderDryRun(selected, parsed.passthrough))
    return
  }

  await runTable(selected, { passthrough: parsed.passthrough, execute: deps.execute })
}

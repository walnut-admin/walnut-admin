/**
 * `pnpm walnut` 的**多选层**：把命令表变成分组选项，并提供一条**可注入**的挑选流程。
 *
 * ## 为什么纯逻辑与界面分开（与 3.1 的分层同一条理由）
 *
 * 界面库只能在真终端里跑，CI 与 agent 都验证不了；而「分组顺序对不对」「取消与空选该不该
 * 执行」是真正的业务判断，必须能单测。所以：
 *
 * - 本模块只认识「分组 → 选项 → 选中的 id」，**不 import 任何界面库、不碰 stdin / stdout、
 *   不读 env**；
 * - 真正起界面的那一份在 `run/clack.ts`（顺带惰性加载界面库），经 {@link CommandPicker} 注入。
 *
 * ## 三种必须分开的结局
 *
 * 取消（Ctrl+C / Esc）、空选（什么都没勾就回车）与「选了几条」是三件不同的事：前两种
 * **什么都没跑**且不算失败（入口正常返回，退出码 0），第三种才交给执行面。若把它们混成
 * 「空数组」一种，入口就只能靠「有没有打日志」去猜用户干了什么。
 *
 * ## 顺序
 *
 * 界面按分组展示，勾选的先后没有任何意义；选中的 id 一律**按表里的顺序**重排
 * （复用 `args.ts` 的 `selectCommands`，与命令行直接给多个 id 时同一套口径）。
 */

import type { Command, CommandGroup } from '../lib/commands.ts'
import { selectCommands } from './args.ts'

/**
 * 多选界面的一项。
 *
 * `value` 是命令 id（清单、`--json`、日志里的 id 三处同一个词）；`label` 把 id 与一句话说明
 * 放进**同一个标签**，而不是把说明塞进 `hint` —— 界面库只对「当前光标所在」与「已勾选」的项
 * 渲染 hint，其余项只剩标签，那样「每项显示 id 与一句话说明」就不成立了。
 */
export interface CommandOption {
  /** 选中后拿到的值（命令 id） */
  value: string
  /** 界面上这一行显示的文字：命令 id 加一句话说明 */
  label: string
}

/** 一个分组及其选项（分组顺序 = 表里首次出现的顺序，组内同样按表） */
export interface CommandGroupOptions {
  group: CommandGroup
  options: CommandOption[]
}

/**
 * 从命令表构造分组选项：分组按**表里首次出现的顺序**，组内按表里的顺序。
 *
 * 刻意不按 `CommandGroup` 联合类型的顺序枚举：那联合类型是「允许哪些分组」，不是展示顺序；
 * 表本身按分组连续排列，按首次出现排能保证「想换分组先后只改表」。
 */
export function buildCommandGroups(commands: readonly Command[]): CommandGroupOptions[] {
  const groups: CommandGroupOptions[] = []
  for (const command of commands) {
    let group = groups.find((item) => item.group === command.group)
    if (group === undefined) {
      group = { group: command.group, options: [] }
      groups.push(group)
    }
    group.options.push({ value: command.id, label: `${command.id}  ${command.label}` })
  }
  return groups
}

/**
 * 挑选函数：拿到分组选项，返回勾中的 id（先后无所谓；`null` = 用户取消）。
 *
 * 真正的实现见 `run/clack.ts`；用例注入假的实现，于是三种结局都能覆盖而不用真起界面。
 */
export type CommandPicker = (
  groups: readonly CommandGroupOptions[],
) => Promise<readonly string[] | null>

/**
 * 多选的四个结局（没有第五种：界面自身抛出的异常不吞，交给 CLI 的顶层映射）。
 *
 * - `non-interactive`：标准输入不是终端 —— 不弹界面、不等待，由调用方按「没给 id」的老办法处理；
 * - `cancelled`：用户取消（Ctrl+C / Esc）—— 什么都没跑，不算失败；
 * - `empty`：用户什么都没勾就回车 —— 什么都没跑，不算失败；
 * - `picked`：选中了若干条，已按表里的顺序排好。
 */
export type ChooseOutcome =
  | { kind: 'non-interactive' }
  | { kind: 'cancelled' }
  | { kind: 'empty' }
  | { kind: 'picked'; commands: Command[] }

export interface ChooseDeps {
  /** 是不是终端（生产路径 = `lib/prompt.ts` 的 `isInteractive`） */
  isInteractive: () => boolean
  picker: CommandPicker
}

/**
 * 交互挑选。**非终端一律不进界面** —— 判定发生在界面之前，因为界面库自己不做这件事。
 *
 * 这条是 `lib/prompt.ts` 头注释里那条硬契约的延伸：CI / pre-push / `| tee` 里的入口一旦
 * 停在界面上，表现出来的是卡死而不是失败，所以非交互调用方必须立刻拿到一个可判定的结局。
 */
export async function chooseCommands(
  commands: readonly Command[],
  deps: ChooseDeps,
): Promise<ChooseOutcome> {
  if (!deps.isInteractive()) return { kind: 'non-interactive' }

  const picked = await deps.picker(buildCommandGroups(commands))
  if (picked === null) return { kind: 'cancelled' }

  // 勾选顺序由界面决定，执行顺序由表决定
  const chosen = selectCommands(commands, picked)
  if (chosen.length === 0) return { kind: 'empty' }
  return { kind: 'picked', commands: chosen }
}

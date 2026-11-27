/**
 * `pnpm walnut` 的**输出渲染**（纯函数，不做 I/O）。
 *
 * 三种形态各自成函数，是为了让输出形状能被用例逐字钉住 —— 清单与 `--json` 都有人（与 agent）
 * 在消费，形状漂移比「打得好不好看」严重得多。打印本身由 `main.ts` 交给 `lib/log.ts`。
 */

import type { Command } from '../lib/commands.ts'

/** 一行一条命令时至少留的 id 列宽（表里现在最长的 id 更长，这里只是下界） */
const MIN_ID_WIDTH = 12

/**
 * 终端显示宽度：中文（CJK）按 2 列算。
 *
 * 为什么需要：分组名是中文，而 `String#length` 按码元计数 —— 直接用 `padEnd` 补齐，
 * 说明列会随分组名的长短错位（`门禁` 是 2 个码元、显示 4 列）。
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    // CJK 部首扩展 ~ 全角形式：本表的分组名全落在这一段里，够用且不引依赖
    width += code >= 0x2e80 && code <= 0xffef ? 2 : 1
  }
  return width
}

/** 补空格到指定的显示宽度 */
function padToDisplayWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

/**
 * 清单：每行一条「id、分组、说明」，顺序与表一致（纯文本，无表头 —— 表头会破坏「一行一条」）。
 */
export function renderList(commands: readonly Command[]): string {
  const idWidth = Math.max(MIN_ID_WIDTH, ...commands.map((command) => command.id.length))
  const groupWidth = Math.max(...commands.map((command) => displayWidth(command.group)))
  return commands
    .map(
      (command) =>
        `  ${command.id.padEnd(idWidth)}  ${padToDisplayWidth(command.group, groupWidth)}  ${command.label}`,
    )
    .join('\n')
}

/** `--json` 里单条命令的机器可读形态（形状由用例钉住） */
export interface CommandJson {
  id: string
  group: string
  label: string
  why: string
  /** 执行形态：`argv` = 经 pnpm 执行；`custom` = 自定义执行函数 */
  kind: 'argv' | 'custom'
  /** 经 pnpm 执行的 argv（`custom` 时为 null） */
  argv: string[] | null
  /** 该命令自己的预算（毫秒）；没给时为 null */
  budgetMs: number | null
  /** 位置参数的用法提示（如 `<name>`）；没声明时为 null —— 为 null 的命令不接受位置参数，传参要写 `--` 之后 */
  positionalArgs: string | null
}

/** 整张表的机器可读形态（`--json` 的正文，也是 agent 读表的入口） */
export interface CommandsJson {
  commands: CommandJson[]
}

export function commandsToJson(commands: readonly Command[]): CommandsJson {
  return {
    commands: commands.map((command) => ({
      id: command.id,
      group: command.group,
      label: command.label,
      why: command.why,
      kind: 'argv' in command ? 'argv' : 'custom',
      argv: 'argv' in command ? [...command.argv] : null,
      budgetMs: command.budgetMs ?? null,
      positionalArgs: command.positionalArgs ?? null,
    })),
  }
}

/** `--json` 的完整正文（缩进 2 空格：人也能读，agent 直接 JSON.parse） */
export function renderJson(commands: readonly Command[]): string {
  return JSON.stringify(commandsToJson(commands), null, 2)
}

/**
 * 一条命令「将要执行的命令行」的展示形态（`--dry-run` 用）。
 *
 * 纯展示：**不**调用 `getPnpmBin()`（那要摸盘，且 dry-run 的语义就是什么都不做），
 * 所以这里写死 `pnpm` 字面量，与真实执行时的绝对路径不同 —— 差别只是打印，不影响语义。
 */
export function commandLineOf(command: Command, passthrough: readonly string[] = []): string {
  if ('run' in command) {
    const carried = passthrough.length === 0 ? '' : `（透传：${passthrough.join(' ')}）`
    return `（自定义执行，不拼命令行）${carried}`
  }
  return ['pnpm', ...command.argv, ...passthrough].join(' ')
}

/** `--dry-run` 的完整正文：每条命令一行「id + 将要执行的命令行」 */
export function renderDryRun(
  commands: readonly Command[],
  passthrough: readonly string[] = [],
): string {
  const lines = [`将要执行 ${commands.length} 条命令（--dry-run，只打印不执行）：`]
  for (const command of commands)
    lines.push(`  ${command.id}  ${commandLineOf(command, passthrough)}`)
  return lines.join('\n')
}

/**
 * `pnpm walnut` 的参数解析（纯函数，不做 I/O）。
 *
 * ## 契约（与计划第 6 节一致）
 *
 * - `pnpm walnut <id> [<id>…]`：按**表里的顺序**执行选中的命令，不看命令行给的先后
 *   （挑选在 {@link selectCommands}，顺序由表决定）。
 * - 入口自身的旗标只有四个：`--list`、`--json`、`--dry-run`、`--help`，而且**只认第一个 id 之前的**。
 * - 第一个 id 之后以 `-` 开头的词属于**那条命令**（透传），入口不再认自己的旗标：
 *   `pnpm walnut db:seed:pg --dry-run` 里的 `--dry-run` 是 db:seed:pg 的。
 * - `--` 之后的参数一律透传。以上两种透传都只允许选中一个 id（多于一个报前置条件错误）。
 * - 非 id、非旗标的词：只有那条命令在表里声明了 `positionalArgs`，才当它的位置参数
 *   （`scaffold:lib foo` 的 `foo`）；否则按「未知命令 id」报错。
 *
 * ## 为什么入口的旗标只认第一个 id 之前的
 *
 * 命令自己也有旗标，而且名字会撞：`db:seed:pg --dry-run`、`release --dry-run`、
 * `scaffold:lib --dry-run` 都是各命令文档里写着的用法。入口若在命令后面继续认 `--dry-run`，
 * 这些命令就会被入口「只打印不执行」地吞掉 —— 看起来跑成功了，实际什么都没做
 * （2026-11-24 复核时实测：`pnpm walnut release --dry-run` 只打印了一行命令就退出 0）。
 * 「工具的选项在前、命令的选项在后」也是 git / pnpm 自己的惯例，不必另学一套。
 *
 * ## 为什么位置参数要命令声明过才算
 *
 * 拼错一个 id 却「跑完了」的形态，比跑红危险得多 —— 它让人以为验过了。如果选中一条命令之后
 * 任何非旗标的词都当参数，`pnpm walnut lint:turbo-cache types:chekc` 就只会跑第一条、还显示通过
 * （2026-11-24 复核时实测）。现在没声明的命令遇到这种词直接报「未知命令 id」；真要传参数，
 * `--` 之后永远可以。空选择不在这里报错（要先打印用法与清单），由 `main.ts` 在打印之后抛。
 */

import type { Command } from '../lib/commands.ts'
import { PreconditionError } from '../lib/errors.ts'

/** 入口的四种结局：执行 / 列清单 / 打 JSON / 打用法 */
export type RunMode = 'run' | 'list' | 'json' | 'help'

export interface RunArgs {
  mode: RunMode
  /** 选中的命令 id（命令行顺序；执行顺序由表决定，见 selectCommands） */
  ids: string[]
  /** 透传给命令的参数（`--` 之后、或单条命令后面那一段） */
  passthrough: string[]
  dryRun: boolean
}

/** 用法文本（`--help` 与「没给 id」两处共用，避免两处漂移） */
export function usageText(): string {
  return [
    '用法：pnpm walnut [选项] <命令 id> [<命令 id>…] [-- <参数>]',
    '      pnpm walnut --list | --json | --help',
    '      pnpm walnut --dry-run <命令 id>',
    '',
    '选项（只认第一个命令 id 之前的）：',
    '  --list     列出全部命令（id、分组、说明）',
    '  --json     以 JSON 打印整张命令表',
    '  --dry-run  只打印将要执行的命令行，不执行',
    '  --help     打印这段用法',
    '',
    '命令 id 之后的旗标属于那条命令，原样交给它（如 pnpm walnut db:seed:pg --dry-run）。',
    '选中的命令按表里的顺序执行；带参数时只允许选中一条命令。',
    '位置参数只有表里声明了 positionalArgs 的命令才接受（如 scaffold:lib <name>）；别的命令传参数写在 -- 之后。',
  ].join('\n')
}

/** 入口旗标 → 模式（`--dry-run` 不是模式，单独处理） */
const MODE_FLAGS: ReadonlyMap<string, RunMode> = new Map([
  ['--list', 'list'],
  ['--json', 'json'],
  ['--help', 'help'],
])

/** 报错里附上的「表里有哪些 id」（未知 id 与未知旗标共用，避免两处漂移） */
function knownIdsHint(commands: readonly Command[]): string {
  return `表里的 id：${commands.map(command => command.id).join(', ')}（表在 tooling/scripts/src/lib/commands.ts）`
}

/**
 * 解析 argv。**只解析，不判定「有没有给 id」** —— 空选择的提示要先打印用法与清单，
 * 那是 `main.ts` 的编排（这里抛会让调用方来不及打印）。
 */
export function parseRunArgs(argv: readonly string[], commands: readonly Command[]): RunArgs {
  const byId = new Map(commands.map(command => [command.id, command] as const))
  const ids: string[] = []
  let passthrough: string[] = []
  let dryRun = false
  let mode: RunMode = 'run'
  let modeFlag: string | null = null

  const setMode = (next: RunMode, flag: string): void => {
    if (mode !== 'run' && mode !== next)
      throw new PreconditionError(`${modeFlag} 与 ${flag} 不能同时给（它们各自就是一种输出）。\n${usageText()}`)
    mode = next
    modeFlag = flag
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    // `--` 之后一律透传（分隔符本身不传）
    if (arg === '--') {
      passthrough = [...argv.slice(index + 1)]
      break
    }

    // 第一个 id 之前：只认入口自己的旗标与命令 id
    if (ids.length === 0) {
      if (arg === '--dry-run') {
        dryRun = true
        continue
      }
      const flagMode = MODE_FLAGS.get(arg)
      if (flagMode !== undefined) {
        setMode(flagMode, arg)
        continue
      }
      if (arg.startsWith('-')) {
        throw new PreconditionError(
          `不认识的参数「${arg}」。入口自己的选项只有 --list / --json / --dry-run / --help，而且要写在第一个命令 id 之前`
          + `（命令自己的旗标写在它的后面）。${knownIdsHint(commands)}\n${usageText()}`,
        )
      }
      if (byId.has(arg)) {
        ids.push(arg)
        continue
      }
      throw new PreconditionError(`未知命令 id「${arg}」。${knownIdsHint(commands)}`)
    }

    // 第一个 id 之后：以 - 开头的词属于那条命令（入口不再认自己的旗标，见文件头）
    if (arg.startsWith('-')) {
      if (ids.length === 1) {
        passthrough = [...argv.slice(index)]
        break
      }
      throw new PreconditionError(
        `已经选中多条命令时不能再带参数：「${arg}」不知道该给谁。要给某条命令传参数就单独跑它。`,
      )
    }
    // 声明了位置参数的命令：它后面第一个非旗标的词就是它的参数，从那里起全部透传。
    // 先于「是不是 id」判断 —— `scaffold:lib lint` 是要建一个叫 lint 的 lib，不是再选一条命令
    if (ids.length === 1 && byId.get(ids[0]!)?.positionalArgs !== undefined) {
      passthrough = [...argv.slice(index)]
      break
    }
    if (byId.has(arg)) {
      if (!ids.includes(arg))
        ids.push(arg)
      continue
    }
    throw new PreconditionError(
      `未知命令 id「${arg}」。${knownIdsHint(commands)}`
      + `（要把它当参数传给 ${ids.join(', ')} 的话，写在 -- 之后）`,
    )
  }

  if (passthrough.length > 0 && ids.length > 1) {
    throw new PreconditionError(
      `透传参数只允许选中一条命令，现在选中了 ${ids.length} 条：${ids.join(', ')}。`
      + '要给多条命令传参数就分别跑两次。',
    )
  }

  return { mode, ids, passthrough, dryRun }
}

/**
 * 按 id 挑选命令，**永远保持表里的顺序**（顺序即执行顺序，命令行给的先后不作数）。
 *
 * 未知 id 已经在 {@link parseRunArgs} 里拦掉；这里只负责挑选与排序，所以它是纯的、可单测的。
 */
export function selectCommands(commands: readonly Command[], ids: readonly string[]): Command[] {
  const wanted = new Set(ids)
  return commands.filter(command => wanted.has(command.id))
}

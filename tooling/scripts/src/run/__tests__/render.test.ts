/**
 * `run/render.ts` 的用例 —— 输出形状有人与 agent 两个消费方，形状漂移必须当场红。
 *
 * 清单与 JSON 的断言刻意写成**逐字/逐键**：它们不是「大概长这样」的日志，而是被脚本与文档
 * 引用的接口（agent 读 `--json` 挑命令、人读 `--list` 找 id）。
 */

import type { Command } from '../../lib/commands.ts'
import { describe, expect, it } from 'vitest'
import { COMMANDS } from '../../lib/commands.ts'
import {
  commandLineOf,
  commandsToJson,
  displayWidth,
  renderDryRun,
  renderJson,
  renderList,
} from '../render.ts'

/** 两张表里最小的一张假表：一条 argv 形态 + 一条自定义形态 */
const TABLE: readonly Command[] = [
  {
    id: 'gate:x',
    group: '门禁',
    label: '某道门禁',
    why: '因为不拦就会静默失效',
    argv: ['exec', 'walnut-check-adr', '--fix'],
  },
  {
    id: 'tool:y',
    group: '工具',
    label: '某个工具',
    why: '因为手改容易漏登记',
    run: async () => {},
  },
]

describe('displayWidth —— 中文按 2 列算', () => {
  it('中文按 2 列、ascii 按 1 列计', () => {
    expect(displayWidth('dev')).toBe(3)
    expect(displayWidth('门禁')).toBe(4)
    expect(displayWidth('发版与镜像')).toBe(10)
  })
})

describe('renderList —— 每行一条「id、分组、说明」', () => {
  it('行数 == 命令数，顺序与表一致', () => {
    const lines = renderList(COMMANDS).split('\n')
    expect(lines).toHaveLength(COMMANDS.length)
    expect(lines.map((line) => line.trim().split(/\s+/)[0])).toEqual(
      COMMANDS.map((command) => command.id),
    )
  })

  it('每行都带 id、分组与说明', () => {
    const lines = renderList(TABLE).split('\n')
    expect(lines).toHaveLength(2)
    for (const [index, command] of TABLE.entries()) {
      expect(lines[index]).toContain(command.id)
      expect(lines[index]).toContain(command.group)
      expect(lines[index]).toContain(command.label)
    }
  })

  it('说明列对齐（分组名是中文，按显示宽度补齐而不是码元数）', () => {
    const lines = renderList(TABLE).split('\n')
    const starts = lines.map((line) => line.indexOf('某'))
    expect(starts[0]).toBe(starts[1])
  })
})

describe('commandsToJson / renderJson —— 机器可读形态', () => {
  it('每项都有 id / group / label / why / kind / argv / budgetMs / positionalArgs 八个键', () => {
    const json = commandsToJson(TABLE)
    expect(json.commands.map((command) => Object.keys(command))).toEqual([
      ['id', 'group', 'label', 'why', 'kind', 'argv', 'budgetMs', 'positionalArgs'],
      ['id', 'group', 'label', 'why', 'kind', 'argv', 'budgetMs', 'positionalArgs'],
    ])
  })

  it('argv 形态带 argv 数组，自定义形态 argv 为 null', () => {
    const [argvCommand, customCommand] = commandsToJson(TABLE).commands
    expect(argvCommand).toEqual({
      id: 'gate:x',
      group: '门禁',
      label: '某道门禁',
      why: '因为不拦就会静默失效',
      kind: 'argv',
      argv: ['exec', 'walnut-check-adr', '--fix'],
      budgetMs: null,
      positionalArgs: null,
    })
    expect(customCommand!.kind).toBe('custom')
    expect(customCommand!.argv).toBeNull()
  })

  it('budgetMs 没给时是 null，给了就是数字（形状稳定，消费方不必判 undefined）', () => {
    const withBudget: Command = {
      id: 'build:x',
      group: '构建',
      label: '构建某物',
      why: '因为构建很慢',
      argv: ['exec', 'turbo', 'build'],
      budgetMs: 1234,
    }
    expect(commandsToJson([withBudget]).commands[0]!.budgetMs).toBe(1234)
  })

  it('positionalArgs 同理：没声明是 null，声明了就是用法提示（agent 据此知道哪条命令要带参数）', () => {
    const withPositional: Command = {
      id: 'make:x',
      group: '工具',
      label: '造一个东西',
      why: '因为手造会漏登记',
      argv: ['exec', 'walnut-make-x'],
      positionalArgs: '<name>',
    }
    expect(commandsToJson([withPositional]).commands[0]!.positionalArgs).toBe('<name>')
    // 真表里声明了位置参数的命令，用法提示不许是空串（空串等于没说）
    for (const command of COMMANDS) {
      if (command.positionalArgs !== undefined)
        expect(
          command.positionalArgs.trim().length,
          `${command.id} 的 positionalArgs 是空串`,
        ).toBeGreaterThan(0)
    }
  })

  it('renderJson 是可 JSON.parse 的正文，且覆盖整张表', () => {
    const parsed = JSON.parse(renderJson(COMMANDS)) as { commands: { id: string }[] }
    expect(parsed.commands).toHaveLength(COMMANDS.length)
    expect(parsed.commands.map((command) => command.id)).toEqual(
      COMMANDS.map((command) => command.id),
    )
  })
})

describe('--dry-run 的展示', () => {
  it('argv 形态打印「pnpm + 完整 argv」，自定义形态不拼命令行', () => {
    expect(commandLineOf(TABLE[0]!)).toBe('pnpm exec walnut-check-adr --fix')
    expect(commandLineOf(TABLE[1]!)).toBe('（自定义执行，不拼命令行）')
  })

  it('透传参数跟在命令行后面 / 在自定义行里注明', () => {
    expect(commandLineOf(TABLE[0]!, ['--py'])).toBe('pnpm exec walnut-check-adr --fix --py')
    expect(commandLineOf(TABLE[1]!, ['--py'])).toBe('（自定义执行，不拼命令行）（透传：--py）')
  })

  it('整段输出形状固定：第一行说「只打印不执行」，之后每条一行', () => {
    expect(renderDryRun(TABLE, ['--py']).split('\n')).toEqual([
      '将要执行 2 条命令（--dry-run，只打印不执行）：',
      '  gate:x  pnpm exec walnut-check-adr --fix --py',
      '  tool:y  （自定义执行，不拼命令行）（透传：--py）',
    ])
  })
})

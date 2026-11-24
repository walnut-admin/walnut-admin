/**
 * `run/select.ts` 的用例 —— 多选层是纯逻辑，界面靠注入。
 *
 * 这里钉的是**分组与结局**，不是界面长什么样：分组顺序错了人就会在错误的组里找命令；
 * 取消与空选若被当成「选了几条」，入口就会去跑一个空表（或反过来把「什么都没跑」报成失败）。
 * 界面库只在 `run/clack.ts` 出现，本文件一次都不加载它。
 */

import type { Command, CommandGroup } from '../../lib/commands.ts'
import { describe, expect, it } from 'vitest'
import { COMMANDS } from '../../lib/commands.ts'
import { buildCommandGroups, chooseCommands } from '../select.ts'

/** 最小命令（分组可指定） */
function command(id: string, group: CommandGroup = '门禁'): Command {
  return { id, group, label: `命令 ${id}`, why: '因为不跑它就会静默失效', argv: ['exec', id] }
}

describe('buildCommandGroups —— 分组与顺序', () => {
  it('分组按表里首次出现的顺序，展平后的 id 与表逐条相等', () => {
    const groups = buildCommandGroups(COMMANDS)
    expect(groups.map(group => group.group)).toEqual([...new Set(COMMANDS.map(cmd => cmd.group))])
    expect(groups.flatMap(group => group.options.map(option => option.value))).toEqual(COMMANDS.map(cmd => cmd.id))
  })

  it('每一项都显示 id 与一句话说明（两者在同一个 label 里，不靠 hint）', () => {
    const options = buildCommandGroups(COMMANDS).flatMap(group => group.options)
    expect(options).toHaveLength(COMMANDS.length)
    for (const [index, option] of options.entries()) {
      const source = COMMANDS[index]!
      expect(option.value).toBe(source.id)
      expect(option.label).toContain(source.id)
      expect(option.label).toContain(source.label)
    }
  })

  it('同组命令不连续出现时仍归到第一次出现的位置（顺序只由表决定）', () => {
    const table = [command('a', '构建'), command('b', '门禁'), command('c', '构建')]
    expect(buildCommandGroups(table).map(group => [group.group, group.options.map(option => option.value)])).toEqual([
      ['构建', ['a', 'c']],
      ['门禁', ['b']],
    ])
  })
})

describe('chooseCommands —— 可注入的挑选流程', () => {
  const table = [command('a'), command('b'), command('c')]

  it('非终端：不进界面（挑选函数一次都不调），交回 non-interactive 由入口报前置条件错误', async () => {
    let called = false
    const outcome = await chooseCommands(table, {
      isInteractive: () => false,
      picker: async () => {
        called = true
        return ['a']
      },
    })
    expect(outcome).toEqual({ kind: 'non-interactive' })
    expect(called).toBe(false)
  })

  it('取消（picker 返回 null）：cancelled，不抛错', async () => {
    await expect(chooseCommands(table, { isInteractive: () => true, picker: async () => null }))
      .resolves
      .toEqual({ kind: 'cancelled' })
  })

  it('空选（picker 返回空数组）：empty，不抛错', async () => {
    await expect(chooseCommands(table, { isInteractive: () => true, picker: async () => [] }))
      .resolves
      .toEqual({ kind: 'empty' })
  })

  it('选了几条：按表里的顺序返回（勾选顺序不作数）', async () => {
    const outcome = await chooseCommands(table, {
      isInteractive: () => true,
      picker: async () => ['c', 'a'],
    })
    expect(outcome.kind).toBe('picked')
    expect(outcome.kind === 'picked' && outcome.commands.map(cmd => cmd.id)).toEqual(['a', 'c'])
  })

  it('挑选函数拿到的是按表分组后的选项（分组与顺序都由本模块给，界面只负责勾）', async () => {
    let seen: unknown
    await chooseCommands(table, {
      isInteractive: () => true,
      picker: async (groups) => {
        seen = groups
        return ['a']
      },
    })
    expect(seen).toEqual(buildCommandGroups(table))
  })
})

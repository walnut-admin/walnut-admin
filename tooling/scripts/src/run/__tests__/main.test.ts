/**
 * `run/main.ts` 的用例 —— 只钉「一个 id 都没给」那一个分支（3.2 的多选入口）。
 *
 * 四种结局各自对应一条**不同的**下一步：取消与空选是「什么都没跑」（正常返回、退出码 0），
 * 选中了则按表顺序执行，非终端则维持老的「打印用法与清单 + 前置条件错误」。把它们混起来
 * —— 例如取消也抛错，或空选也跑一遍执行面 —— 在终端里只表现为「按了 Ctrl+C 却红了」，
 * 而在 CI 里则表现为「入口卡住」。所以这里注入挑选函数与终端判定，一次都不真起界面；
 * 执行出口也注入，一次都不真起 pnpm。
 */

import type { CommandExecutor } from '../execute.ts'
import type { CommandPicker } from '../select.ts'
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreconditionError } from '../../lib/errors.ts'
import { main } from '../main.ts'

/** 固定的挑选结果（null = 取消，[] = 空选） */
const pick =
  (ids: readonly string[] | null): CommandPicker =>
  async () =>
    ids

describe('main —— 没有给 id 时的交互多选', () => {
  let written: { fd: number; text: string }[]
  let executed: string[]

  beforeEach(() => {
    written = []
    executed = []
    // 同 execute.test.ts：非 TTY 下 log.ts 走 fs.writeSync，拦它就能捕获输出
    vi.spyOn(fs, 'writeSync').mockImplementation(((fd: number, text: string) => {
      written.push({ fd, text })
      return 0
    }) as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const stdoutText = (): string =>
    written
      .filter((item) => item.fd !== 2)
      .map((item) => item.text)
      .join('')
  const fakeExecute: CommandExecutor = async (command) => {
    executed.push(command.id)
  }
  const neverPick: CommandPicker = async () => {
    throw new Error('这条路径不该起界面')
  }

  it('取消（picker 返回 null）：不执行、不抛错，只打一行「已取消」', async () => {
    await expect(
      main([], { isInteractive: () => true, picker: pick(null), execute: fakeExecute }),
    ).resolves.toBeUndefined()
    expect(executed).toEqual([])
    expect(stdoutText()).toContain('已取消，什么都没跑')
  })

  it('空选（picker 返回空数组）：不执行、不抛错，只打一行「没有选中任何命令」', async () => {
    await expect(
      main([], { isInteractive: () => true, picker: pick([]), execute: fakeExecute }),
    ).resolves.toBeUndefined()
    expect(executed).toEqual([])
    expect(stdoutText()).toContain('没有选中任何命令，什么都没跑')
  })

  it('选中若干条：按表顺序执行（勾选顺序不作数）', async () => {
    await main([], {
      isInteractive: () => true,
      picker: pick(['lint:doc-ts', 'lint:adr']),
      execute: fakeExecute,
    })
    expect(executed).toEqual(['lint:adr', 'lint:doc-ts'])
    expect(stdoutText()).toContain('2 段：2 段真跑通过')
  })

  it('非终端：前置条件错误（退出码 2 的来源），且根本不起界面', async () => {
    await expect(
      main([], { isInteractive: () => false, picker: neverPick }),
    ).rejects.toBeInstanceOf(PreconditionError)
    expect(stdoutText()).toContain('用法：pnpm walnut')
    // 老行为照旧：清单也要打出来
    expect(stdoutText()).toContain('lint:adr')
  })

  it('--dry-run 不带 id：不进多选（不探测 TTY），行为与 3.1 一致', async () => {
    await expect(
      main(['--dry-run'], { isInteractive: () => true, picker: neverPick }),
    ).rejects.toBeInstanceOf(PreconditionError)
  })

  it('--list 不起界面（多选只在「没有给 id 且非 dry-run」时才可能发生）', async () => {
    await expect(
      main(['--list'], { isInteractive: () => true, picker: neverPick }),
    ).resolves.toBeUndefined()
    expect(stdoutText()).toContain('lint:adr')
  })
})

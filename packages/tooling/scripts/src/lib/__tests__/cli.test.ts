/**
 * `lib/cli.ts` 的用例 —— 钉住**错误 → 退出码**那张表。
 *
 * 为什么值得一条用例：这张表是"哪一类失败 → 哪个码"的**唯一映射点**，而它此前被抄在十几个 bin 里
 * （抄法还不一致）。用例的价值不在"跑通"，而在于它把三态**逐条钉死** —— 谁改映射，这里先红。
 *
 * ⚠️ 输出是拦 `fs.writeSync` 而不是 spy 模块内部的函数：`log.ts` 在非 TTY 下走 `fs.writeSync(fd, …)`，
 * 而 **ESM 模块内部调用拦不住**（`vi.spyOn(log, 'writeOut')` 对同模块内的调用无效 —— 实测）。
 * 这样顺带能断言"违规走的是 **stderr**"。
 */
import fs from 'node:fs'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runCli } from '../cli.ts'
import { PreconditionError, ViolationError } from '../errors.ts'

describe('runCli —— 错误 → 退出码', () => {
  const originalExitCode = process.exitCode
  let written: { fd: number, text: string }[]

  beforeEach(() => {
    written = []
    vi.spyOn(fs, 'writeSync').mockImplementation(((fd: number, text: string) => {
      written.push({ fd, text })
      return 0
    }) as never)
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = originalExitCode
  })

  const stderrText = () => written.filter(w => w.fd === 2).map(w => w.text).join('')
  const stdoutText = () => written.filter(w => w.fd !== 2).map(w => w.text).join('')

  it('正常返回 → 0，且什么都不打', async () => {
    await runCli(() => {})
    expect(process.exitCode).toBe(0)
    expect(written).toEqual([])
  })

  it('显式返回 0 → 0（兼容老写法）', async () => {
    await runCli(() => 0)
    expect(process.exitCode).toBe(0)
  })

  it('抛 ViolationError → 1，统一打「✖ <结语>」且走 stderr', async () => {
    await runCli(() => {
      throw new ViolationError('有 3 处问题（明细见上）')
    })
    expect(process.exitCode).toBe(1)
    expect(stderrText()).toBe('✖ 有 3 处问题（明细见上）\n')
    expect(stdoutText()).toBe('')
  })

  it('抛 PreconditionError → 2，统一加「前置条件未满足：」前缀', async () => {
    await runCli(() => {
      throw new PreconditionError('产物目录不存在')
    })
    expect(process.exitCode).toBe(2)
    expect(stderrText()).toBe('✖ 前置条件未满足：产物目录不存在\n')
  })

  it('抛别的异常 → 1（是**脚本自己**出问题，不该让人去修前置条件），并带上 stack', async () => {
    await runCli(() => {
      throw new TypeError('x is not a function')
    })
    expect(process.exitCode).toBe(1)
    expect(stderrText()).toContain('脚本自己出错了')
    expect(stderrText()).toContain('x is not a function')
  })

  it('异步 main 也走同一套（await 后再映射）', async () => {
    await runCli(async () => {
      throw new ViolationError('异步失败')
    })
    expect(process.exitCode).toBe(1)
    expect(stderrText()).toContain('异步失败')
  })

  // 用 `process.exitCode` 而不是 `process.exit()` 是刻意的：后者会切断还没冲刷的异步 stdout。
  // 这条用例钉住"它不调 process.exit"—— 否则将来有人图省事改回去，管道下的输出会静默丢。
  it('不调用 process.exit（否则管道下会丢还没冲刷的输出）', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('不该被调用')
    }) as never)
    await runCli(() => 0)
    expect(exit).not.toHaveBeenCalled()
  })
})

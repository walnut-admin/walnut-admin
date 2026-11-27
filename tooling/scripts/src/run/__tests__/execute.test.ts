/**
 * `run/execute.ts` 的用例 —— 三种结局（全通过 / 有失败 / 有跳过）与执行器接线。
 *
 * 为什么注入执行器：跳过只在**子进程真的报退出码 3** 时出现，而失败与跳过的区别正是这条入口
 * 最容易写错的地方（把「没验过」读成「验过了」）。注入之后三种结局都有真用例；另外两条
 * 用例用 `bin: process.execPath` 把「pnpm 命令」换成毫秒级的 `node -e`，验的是**真接线**
 * （cwd / 预算环境变量 / 三态归类），而不是一个假执行器。
 *
 * 输出用拦 `fs.writeSync` 的方式捕获（同 `lib/__tests__/cli.test.ts` 的理由：`log.ts` 在非 TTY
 * 下走 `fs.writeSync`，而 ESM 模块内部调用拦不住）。
 */

import type { Command, CustomCommand, PnpmCommand } from '../../lib/commands.ts'
import fs from 'node:fs'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChildRunError } from '../../lib/child-run.ts'
import {
  PreconditionError,
  SKIPPED_EXIT_CODE,
  SkippedError,
  ViolationError,
} from '../../lib/errors.ts'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import { createPnpmCommandExecutor, RUN_BUDGET_ENV, runCommands, runTable } from '../execute.ts'

const MINUTE = 60_000

/** 一条最小的 argv 命令 */
function pnpmCommand(id: string, extra: Partial<PnpmCommand> = {}): PnpmCommand {
  return {
    id,
    group: '门禁',
    label: `命令 ${id}`,
    why: '因为不跑它就会静默失效',
    argv: ['exec', id],
    ...extra,
  }
}

/** 一条最小的自定义命令（默认什么都不做） */
function customCommand(id: string, run: CustomCommand['run'] = async () => {}): CustomCommand {
  return { id, group: '工具', label: `命令 ${id}`, why: '因为它不是 pnpm 脚本', run }
}

type Behavior = 'ok' | 'fail' | 'precondition' | 'skip' | 'skipped-error'

/** 假执行器：按 id 决定结局，同时记下调用顺序与收到的透传参数 */
function fakeExecutor(behaviors: Record<string, Behavior> = {}): {
  execute: (
    command: Command,
    args: readonly string[],
    write: (text: string) => void,
  ) => Promise<void>
  calls: string[]
  args: readonly (readonly string[])[]
} {
  const calls: string[] = []
  const args: (readonly string[])[] = []
  const execute = async (
    command: Command,
    forwarded: readonly string[],
    write: (text: string) => void,
  ): Promise<void> => {
    calls.push(command.id)
    args.push(forwarded)
    write(`输出：${command.id}\n`)
    const behavior = behaviors[command.id] ?? 'ok'
    if (behavior === 'fail') throw new ChildRunError(`${command.id} 跑挂了`, 1)
    if (behavior === 'precondition') throw new ChildRunError(`${command.id} 前置条件不成立`, 2)
    if (behavior === 'skip') throw new ChildRunError(`${command.id} 未验证`, SKIPPED_EXIT_CODE)
    if (behavior === 'skipped-error') throw new SkippedError(`${command.id} 本机没有工具`)
  }
  return { execute, calls, args }
}

/** 三态归类（`runCommands` 不抛，只把结局记进 results） */
describe('runCommands —— 三态归类', () => {
  it('全通过 ⇒ 每条都 ok，且按给定顺序调用', async () => {
    const fake = fakeExecutor()
    const { results, firstFailure } = await runCommands([pnpmCommand('a'), pnpmCommand('b')], {
      execute: fake.execute,
    })
    expect(results.map((result) => result.status)).toEqual(['ok', 'ok'])
    expect(fake.calls).toEqual(['a', 'b'])
    expect(firstFailure).toBeUndefined()
  })

  it('一条失败不中断其余几条（命令之间没有依赖，跑完再回放）', async () => {
    const fake = fakeExecutor({ b: 'fail' })
    const { results, firstFailure } = await runCommands(
      [pnpmCommand('a'), pnpmCommand('b'), pnpmCommand('c')],
      { execute: fake.execute },
    )
    expect(results.map((result) => `${result.gate.id}:${result.status}`)).toEqual([
      'a:ok',
      'b:failed',
      'c:ok',
    ])
    expect(fake.calls).toEqual(['a', 'b', 'c'])
    expect(firstFailure).toBeInstanceOf(ChildRunError)
  })

  it('子进程退出 3 与 SkippedError 都归「跳过」，其余非零归「失败」', async () => {
    const fake = fakeExecutor({ b: 'skip', c: 'skipped-error', d: 'precondition' })
    const { results } = await runCommands(
      [pnpmCommand('a'), pnpmCommand('b'), pnpmCommand('c'), pnpmCommand('d')],
      { execute: fake.execute },
    )
    expect(results.map((result) => result.status)).toEqual(['ok', 'skipped', 'skipped', 'failed'])
  })

  it('失败与跳过的输出都进 result.output（失败回放靠它）', async () => {
    const fake = fakeExecutor({ b: 'fail' })
    const { results } = await runCommands([pnpmCommand('a'), pnpmCommand('b')], {
      execute: fake.execute,
    })
    expect(results[1]!.output).toContain('输出：b')
    expect(results[1]!.output).toContain('b 跑挂了')
  })

  it('透传参数原样交给执行器', async () => {
    const fake = fakeExecutor()
    await runCommands([pnpmCommand('a')], { execute: fake.execute, passthrough: ['--k=v', 'x'] })
    expect(fake.args).toEqual([['--k=v', 'x']])
  })
})

describe('runTable —— 三种结局的收尾', () => {
  let written: { fd: number; text: string }[]

  beforeEach(() => {
    written = []
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
  const stderrText = (): string =>
    written
      .filter((item) => item.fd === 2)
      .map((item) => item.text)
      .join('')
  /** 走完收尾并拿到抛出来的东西（通过时是 undefined） */
  const outcome = async (promise: Promise<void>): Promise<unknown> =>
    promise.then(
      () => undefined,
      (error: unknown) => error,
    )

  it('全通过 ⇒ 正常返回，汇总说清「几条真跑通过」', async () => {
    const fake = fakeExecutor()
    const error = await outcome(
      runTable([pnpmCommand('a'), pnpmCommand('b')], { execute: fake.execute }),
    )
    expect(error).toBeUndefined()
    expect(stdoutText()).toContain('2 段：2 段真跑通过')
    expect(stderrText()).toBe('')
  })

  it('有失败 ⇒ 抛 ViolationError（退出码 1），其余命令照跑，失败明细整段回放', async () => {
    const fake = fakeExecutor({ b: 'fail' })
    const error = await outcome(
      runTable([pnpmCommand('a'), pnpmCommand('b'), pnpmCommand('c')], { execute: fake.execute }),
    )
    expect(fake.calls).toEqual(['a', 'b', 'c'])
    expect(error).toBeInstanceOf(ViolationError)
    expect(stderrText()).toContain('为什么必须有这一条')
    expect(stderrText()).toContain('输出：b')
    expect(stderrText()).toContain('1/3 条命令失败：b')
  })

  it('失败的子进程退出 2 / 超时 ⇒ 前置条件未满足（与 ci:local 的 failureToError 同一口径）', async () => {
    const fake = fakeExecutor({ a: 'precondition' })
    const error = await outcome(runTable([pnpmCommand('a')], { execute: fake.execute }))
    expect(error).toBeInstanceOf(PreconditionError)
  })

  it('无失败但有跳过 ⇒ 抛 SkippedError（退出码 3），并写明「跳过不等于通过」', async () => {
    const fake = fakeExecutor({ b: 'skip' })
    const error = await outcome(
      runTable([pnpmCommand('a'), pnpmCommand('b')], { execute: fake.execute }),
    )
    expect(error).toBeInstanceOf(SkippedError)
    expect((error as Error).message).toContain('跳过不等于通过')
    expect((error as Error).message).toContain('b')
  })

  it('失败与跳过并存 ⇒ 以失败为准（跳过的段仍单列出来）', async () => {
    const fake = fakeExecutor({ b: 'fail', c: 'skip' })
    const error = await outcome(
      runTable([pnpmCommand('a'), pnpmCommand('b'), pnpmCommand('c')], { execute: fake.execute }),
    )
    expect(error).toBeInstanceOf(ViolationError)
    expect(stderrText()).toContain('未验证的段：c')
  })

  it('多条失败时以表顺序的第一条为准（先修它）', async () => {
    const fake = fakeExecutor({ a: 'precondition', b: 'fail' })
    const error = await outcome(
      runTable([pnpmCommand('a'), pnpmCommand('b')], { execute: fake.execute }),
    )
    expect(error).toBeInstanceOf(PreconditionError)
  })
})

describe('createPnpmCommandExecutor —— 真接线（bin 换成 node，不真起 pnpm）', () => {
  let written: { fd: number; text: string }[]

  beforeEach(() => {
    written = []
    vi.spyOn(fs, 'writeSync').mockImplementation(((fd: number, text: string) => {
      written.push({ fd, text })
      return 0
    }) as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cwd 恒为仓库根（从子目录跑时 pnpm 会解析到最近那个包的脚本）', async () => {
    const command = pnpmCommand('cwd', { argv: ['-e', 'process.stdout.write(process.cwd())'] })
    await createPnpmCommandExecutor({ bin: process.execPath })(command, [], () => {})
    const stdout = written
      .filter((w) => w.fd === 1)
      .map((w) => w.text)
      .join('')
    expect(stdout).toContain(REPO_ROOT)
  })

  it('子进程输出实时转播：stdout 进 fd 1、stderr 进 fd 2（CI 日志要看得见门禁自己打的证据）', async () => {
    const command = pnpmCommand('relay', {
      argv: ['-e', 'process.stdout.write("relay-out"); process.stderr.write("relay-err")'],
    })
    await createPnpmCommandExecutor({ bin: process.execPath })(command, [], () => {})
    expect(
      written
        .filter((w) => w.fd === 1)
        .map((w) => w.text)
        .join(''),
    ).toContain('relay-out')
    expect(
      written
        .filter((w) => w.fd === 2)
        .map((w) => w.text)
        .join(''),
    ).toContain('relay-err')
  })

  it('注入 output 时子进程输出改走收集器（用例与需要截流的调用方用）', async () => {
    const chunks: string[] = []
    const command = pnpmCommand('sink', { argv: ['-e', 'process.stdout.write("sink-out")'] })
    await createPnpmCommandExecutor({
      bin: process.execPath,
      output: { write: (text) => chunks.push(text) },
    })(command, [], () => {})
    expect(chunks.join('')).toContain('sink-out')
    expect(
      written
        .filter((w) => w.fd === 1)
        .map((w) => w.text)
        .join(''),
    ).not.toContain('sink-out')
  })

  it('子进程退出 3 ⇒ ChildRunError(3)：跳过只在三态码上出现', async () => {
    const command = pnpmCommand('skip', { argv: ['-e', `process.exit(${SKIPPED_EXIT_CODE})`] })
    const error = await createPnpmCommandExecutor({ bin: process.execPath })(
      command,
      [],
      () => {},
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(ChildRunError)
    expect((error as ChildRunError).exitCode).toBe(SKIPPED_EXIT_CODE)
  })

  it('命令表里的 budgetMs 变成该条命令的预算', async () => {
    // 5s 的命令 + 300ms 预算：通过 = 预算没生效（那才是要抓的回归）
    const command = pnpmCommand('slow', {
      argv: ['-e', 'setTimeout(() => {}, 5000)'],
      budgetMs: 300,
    })
    const error = await createPnpmCommandExecutor({ bin: process.execPath })(
      command,
      [],
      () => {},
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(ChildRunError)
    expect((error as ChildRunError).exitCode).toBe(2)
    expect((error as Error).message).toMatch(/超时/)
  }, 15_000)

  it('预算环境变量是入口自己的那个名字（WALNUT_RUN_BUDGET_MS），且优先于 budgetMs', async () => {
    expect(RUN_BUDGET_ENV).toBe('WALNUT_RUN_BUDGET_MS')
    const saved = process.env[RUN_BUDGET_ENV]
    process.env[RUN_BUDGET_ENV] = '300'
    try {
      // 命令自己说 1 分钟（宽松），环境变量说 300ms ⇒ 必须按环境变量收
      const command = pnpmCommand('env-budget', {
        argv: ['-e', 'setTimeout(() => {}, 5000)'],
        budgetMs: MINUTE,
      })
      const error = await createPnpmCommandExecutor({ bin: process.execPath })(
        command,
        [],
        () => {},
      ).then(
        () => undefined,
        (caught: unknown) => caught,
      )
      expect(error).toBeInstanceOf(ChildRunError)
      expect((error as ChildRunError).exitCode).toBe(2)
    } finally {
      if (saved === undefined) delete process.env[RUN_BUDGET_ENV]
      else process.env[RUN_BUDGET_ENV] = saved
    }
  }, 15_000)

  it('自定义命令直接调它的 run，参数原样传进去', async () => {
    let seen: readonly string[] = []
    const command = customCommand('custom', async (args) => {
      seen = args
    })
    await createPnpmCommandExecutor({ bin: process.execPath })(command, ['--only=x'], () => {})
    expect(seen).toEqual(['--only=x'])
  })

  it('只有自定义命令时不需要 pnpm（惰性取路径，不摸盘）', async () => {
    // 不传 bin：这条路径若提前调 getPnpmBin 就会摸盘；自定义命令走的是 run，不经过它
    const command = customCommand('custom')
    await expect(createPnpmCommandExecutor()(command, [], () => {})).resolves.toBeUndefined()
  })
})

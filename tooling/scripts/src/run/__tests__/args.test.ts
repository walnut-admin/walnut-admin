/**
 * `run/args.ts` 的用例 —— 钉住命令行契约（计划第 6 节）。
 *
 * 这些约定里**没有一条**是「跑起来才发现」的：拼错 id、把透传给到多条命令、把入口旗标当成
 * 透传，全都会表现成「命令跑完了、但跑的不是你以为的那条」—— 静默失效。所以逐条钉住。
 */

import { describe, expect, it } from 'vitest'
import { COMMANDS } from '../../lib/commands.ts'
import { PreconditionError } from '../../lib/errors.ts'
import { parseRunArgs, selectCommands } from '../args.ts'

describe('parseRunArgs —— 选择与顺序', () => {
  it('多个 id 按命令行顺序记下（执行顺序由 selectCommands 按表重排）', () => {
    const parsed = parseRunArgs(['lint:doc-ts', 'lint:adr'], COMMANDS)
    expect(parsed.mode).toBe('run')
    expect(parsed.ids).toEqual(['lint:doc-ts', 'lint:adr'])
    expect(parsed.passthrough).toEqual([])
  })

  it('selectCommands 永远按表里的顺序返回（命令行给的先后不作数）', () => {
    const picked = selectCommands(COMMANDS, ['lint:doc-ts', 'lint:adr'])
    const ids = picked.map((command) => command.id)
    const at = (id: string): number => COMMANDS.findIndex((command) => command.id === id)
    expect(ids).toEqual(['lint:adr', 'lint:doc-ts'])
    expect(at('lint:adr')).toBeLessThan(at('lint:doc-ts'))
  })

  it('重复 id 只算一次（跑两遍同一条命令没有意义）', () => {
    const parsed = parseRunArgs(['lint:adr', 'lint:adr'], COMMANDS)
    expect(parsed.ids).toEqual(['lint:adr'])
  })

  it('没有给 id 时 ids 为空 —— 报错与打印留给 main（它要先打用法与清单）', () => {
    expect(parseRunArgs([], COMMANDS).ids).toEqual([])
    expect(parseRunArgs(['--dry-run'], COMMANDS).ids).toEqual([])
  })
})

describe('parseRunArgs —— 未知 id / 未知旗标必须报错', () => {
  it('未知 id 抛前置条件错误，并列出表里真实的 id', () => {
    const run = (): unknown => parseRunArgs(['nope'], COMMANDS)
    expect(run).toThrow(PreconditionError)
    expect(run).toThrow(/未知命令 id「nope」/)
    // 真实 id 必须列出来，否则用户只能去翻源码
    for (const id of ['lint:adr', 'db:seed:pg', 'build:docs'])
      expect(run).toThrow(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })

  it('未知旗标（没有选中任何命令时）抛前置条件错误，并列出真实的 id', () => {
    expect(() => parseRunArgs(['--nope'], COMMANDS)).toThrow(PreconditionError)
    expect(() => parseRunArgs(['--filter=@walnut/admin'], COMMANDS)).toThrow(/不认识的参数/)
    expect(() => parseRunArgs(['--nope'], COMMANDS)).toThrow(new RegExp(COMMANDS[0]!.id))
  })
})

describe('parseRunArgs —— 透传', () => {
  it('`--` 之后的参数进 passthrough，分隔符本身不传', () => {
    const parsed = parseRunArgs(['lint:adr', '--', '--fix', 'x'], COMMANDS)
    expect(parsed.ids).toEqual(['lint:adr'])
    expect(parsed.passthrough).toEqual(['--fix', 'x'])
  })

  it('单条命令后面以 - 开头的参数也当透传（CI 的 --cache-dir=… 靠这条）', () => {
    const parsed = parseRunArgs(['build:docs', '--cache-dir=.turbo/cache-docs'], COMMANDS)
    expect(parsed.ids).toEqual(['build:docs'])
    expect(parsed.passthrough).toEqual(['--cache-dir=.turbo/cache-docs'])
    expect(parsed.dryRun).toBe(false)
  })

  it('声明了 positionalArgs 的命令：后面的位置参数进透传（`scaffold:lib foo` 的 foo）', () => {
    const parsed = parseRunArgs(['scaffold:lib', 'foo', '--layer=infra'], COMMANDS)
    expect(parsed.ids).toEqual(['scaffold:lib'])
    expect(parsed.passthrough).toEqual(['foo', '--layer=infra'])
  })

  it('声明了位置参数的命令：紧跟的词即使与某个 id 同名也是它的参数（`scaffold:lib lint` 是要建一个叫 lint 的 lib）', () => {
    const parsed = parseRunArgs(['scaffold:lib', 'lint'], COMMANDS)
    expect(parsed.ids).toEqual(['scaffold:lib'])
    expect(parsed.passthrough).toEqual(['lint'])
  })

  // 这一条是**回归锚**：以前选中一条命令之后，任何非 id 的词都被吞成它的参数 ——
  // `lint:turbo-cache types:chekc`（第二个 id 拼错）于是只跑第一条还显示通过。
  it('没声明 positionalArgs 的命令：后面出现非 id 的词 ⇒ 按未知命令 id 报错（拼错的 id 不许被吞成参数）', () => {
    const run = (): unknown => parseRunArgs(['lint:turbo-cache', 'types:chekc'], COMMANDS)
    expect(run).toThrow(PreconditionError)
    expect(run).toThrow(/未知命令 id「types:chekc」/)
    // 报错要指出路：真要当参数传，写在 -- 之后
    expect(run).toThrow(/写在 -- 之后/)
    const explicit = parseRunArgs(['lint:turbo-cache', '--', 'types:chekc'], COMMANDS)
    expect(explicit.ids).toEqual(['lint:turbo-cache'])
    expect(explicit.passthrough).toEqual(['types:chekc'])
  })

  // 这一条也是回归锚：以前入口在命令后面继续认 --dry-run / --help，于是
  // `pnpm walnut release --dry-run` 被入口「只打印不执行」地吞掉，命令自己的 --dry-run 根本传不到。
  it('入口自己的旗标写在命令后面 ⇒ 属于那条命令，不再被入口吞掉', () => {
    const release = parseRunArgs(['release', '--dry-run'], COMMANDS)
    expect(release.dryRun).toBe(false)
    expect(release.mode).toBe('run')
    expect(release.passthrough).toEqual(['--dry-run'])

    const seed = parseRunArgs(['db:seed:pg', '--dry-run'], COMMANDS)
    expect(seed.dryRun).toBe(false)
    expect(seed.passthrough).toEqual(['--dry-run'])

    // 同理 --help / --list：命令后面的是命令的
    expect(parseRunArgs(['scaffold:lib', '--help'], COMMANDS)).toMatchObject({
      mode: 'run',
      passthrough: ['--help'],
    })
    expect(parseRunArgs(['lint:adr', '--list'], COMMANDS)).toMatchObject({
      mode: 'run',
      passthrough: ['--list'],
    })

    // 入口自己的仍然要写在命令之前
    expect(parseRunArgs(['--dry-run', 'lint:adr'], COMMANDS).dryRun).toBe(true)
    expect(parseRunArgs(['--dry-run', 'lint:adr'], COMMANDS).passthrough).toEqual([])
  })

  it('多条命令 + 透传 ⇒ 前置条件错误（参数该给哪条是歧义）', () => {
    expect(() => parseRunArgs(['lint:adr', 'lint:doc-ts', '--', 'x'], COMMANDS)).toThrow(
      PreconditionError,
    )
    expect(() => parseRunArgs(['lint:adr', 'lint:doc-ts', '--', 'x'], COMMANDS)).toThrow(
      /只允许选中一条命令/,
    )
    expect(() => parseRunArgs(['lint:adr', 'lint:doc-ts', '--cache-dir=x'], COMMANDS)).toThrow(
      /已经选中多条命令时不能再带参数/,
    )
  })
})

describe('parseRunArgs —— 入口旗标', () => {
  it('--list / --json / --help 各自成为一种模式', () => {
    expect(parseRunArgs(['--list'], COMMANDS).mode).toBe('list')
    expect(parseRunArgs(['--json'], COMMANDS).mode).toBe('json')
    expect(parseRunArgs(['--help'], COMMANDS).mode).toBe('help')
  })

  it('--dry-run 不是模式（它和「选中哪些命令」并存）', () => {
    const parsed = parseRunArgs(['--dry-run', 'lint:adr'], COMMANDS)
    expect(parsed.mode).toBe('run')
    expect(parsed.dryRun).toBe(true)
    expect(parsed.ids).toEqual(['lint:adr'])
  })

  it('两种输出模式同时给 ⇒ 前置条件错误（不许静默挑一个）', () => {
    expect(() => parseRunArgs(['--list', '--json'], COMMANDS)).toThrow(PreconditionError)
  })
})

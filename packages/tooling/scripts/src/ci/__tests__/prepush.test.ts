/**
 * 推送前门禁表（`src/ci/prepush.ts`）的机械审计。
 *
 * 集中到一张表之后，**新的失败模式是表里写错**（脚本名打错、`why` 敷衍、id 重名）—— 而这些
 * 一旦错就会**静默地少跑一道闸**，正是本仓最忌讳的形态。所以这里的用例重点不是「跑得对」，
 * 而是「表本身站得住」：每个 `argv` 都得能落到根 `package.json` 里真实存在的脚本上。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ChildRunError } from '../../lib/child-run.ts'
import { SKIPPED_EXIT_CODE } from '../../lib/errors.ts'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import { formatLine, PREPUSH_GATES, runGates, strictFailureMessage, summarizeRun } from '../prepush.ts'

const rootManifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}
const rootScripts = new Set(Object.keys(rootManifest.scripts ?? {}))

/** `argv[0]` 是 pnpm 自己的子命令（不是根脚本名）时，这几个是合法的例外 */
const PNPM_SUBCOMMANDS = new Set(['exec', 'change'])

describe('pREPUSH_GATES —— 表本身', () => {
  it('id 无重复且都非空', () => {
    const ids = PREPUSH_GATES.map(g => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids)
      expect(id, 'id 不能为空').not.toBe('')
  })

  it('每一段的 argv（含 followups）都能落到**真实存在**的根脚本 / pnpm 子命令上', () => {
    // 这条守卫就是「表里打错一个脚本名」的拦网：那种错会让整段门禁静默消失。
    // followups 也一并校验 —— 它们是同一段的后续命令，写错了同样是静默少跑一道闸。
    for (const gate of PREPUSH_GATES) {
      for (const [index, argv] of [gate.argv, ...(gate.followups ?? [])].entries()) {
        const where = index === 0 ? 'argv' : `followups[${index - 1}]`
        const head = argv[0]
        expect(head, `${gate.id}.${where}: 不能为空`).toBeTruthy()
        if (PNPM_SUBCOMMANDS.has(head!)) {
          expect(argv.length, `${gate.id}.${where}: pnpm 子命令不该只有一段`).toBeGreaterThan(1)
          continue
        }
        expect(rootScripts.has(head!), `${gate.id}.${where}: 根 package.json 里没有脚本 \`${head}\``).toBe(true)
      }
    }
  })

  it('openapi 段同时查暂存区（F-53 边界①：已 add 的生成物不许让门禁绿）', () => {
    const openapi = PREPUSH_GATES.find(gate => gate.id === 'openapi')
    expect(openapi, 'openapi 段不见了 —— 门禁被摘').toBeTruthy()

    const followups = openapi!.followups ?? []
    const staged = followups.find(argv => argv.includes('--cached'))
    expect(staged, 'openapi 段缺少 `git diff --cached` 这一步：git diff 只比工作区 vs 暂存区，已 add 的生成物会让门禁假绿').toBeTruthy()

    // 两个生成物都要盯：只查一个等于漏一个
    // 段② 的产物（schema.d.ts）2026-11 批次 4 · D9 起在 packages/generated/api-types 下
    for (const generated of ['apps/server/openapi.json', 'packages/generated/api-types/src/schema.d.ts']) {
      expect(staged!.includes(generated), `${generated} 不在暂存区比对里`).toBe(true)
    }
  })

  it('circular 段在表里，且链路真的带 --circular（摘掉旗标 = 门禁变成只数文件）', () => {
    const gate = PREPUSH_GATES.find(g => g.id === 'circular')
    expect(gate, 'circular 段不见了 —— 环会重新变回「没有任何闸看得见」的失效面').toBeTruthy()
    expect(gate!.argv[0], 'circular 段必须经根脚本转发（这样 CI 与发版电池才引用得到同一个脚本名）').toBe('madge:check')

    // 根脚本 → apps/server 的同名脚本 → madge 的旗标，链条上任一环写错都让这一段变成空转：
    // 少了 --circular 它只输出文件清单（永远 0 环）；少了 --extensions 它默认只认 .js
    // （本仓 1050 个文件里 .ts 占绝大多数 ⇒ 静默 0 环）。
    const rootCmd = rootManifest.scripts?.['madge:check'] ?? ''
    expect(rootCmd, '根脚本 madge:check 没指向 apps/server').toContain('apps/server')

    const serverManifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'apps/server/package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    const madgeCmd = serverManifest.scripts?.madge ?? ''
    expect(madgeCmd, 'apps/server 的 madge 脚本没有 --circular').toContain('--circular')
    expect(madgeCmd, 'apps/server 的 madge 脚本没有 --extensions（默认只认 .js ⇒ 静默 0 环）').toMatch(/--extensions[= ]/)
  })

  it('负对照：真造一个环 madge 必须非零退出；正对照：无环必须零退出', () => {
    // 这条是「环 = 失败」的**实测版**，不是对配置的二次解读：拿 madge 自己跑一个两文件的环。
    // 正对照同时在，防止「永远失败」也能让上一条绿。
    const madgeCli = path.join(REPO_ROOT, 'apps/server/node_modules/madge/bin/cli.js')
    expect(existsSync(madgeCli), `找不到 madge 的入口：${madgeCli}（先 pnpm install）`).toBe(true)

    const run = (files: Record<string, string>): { status: number | null, out: string } => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'walnut-madge-'))
      try {
        for (const [name, body] of Object.entries(files))
          writeFileSync(path.join(dir, name), body)
        const r = spawnSync(process.execPath, [madgeCli, '--circular', '--extensions', 'ts', dir], { encoding: 'utf8' })
        return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
      }
      finally {
        // 自建的临时目录（os.tmpdir 下，不是仓库内容）
        rmSync(dir, { recursive: true, force: true })
      }
    }

    const cyclic = run({
      'a.ts': 'import { b } from \'./b\'\nexport const a = (): unknown => b\n',
      'b.ts': 'import { a } from \'./a\'\nexport const b = (): unknown => a\n',
    })
    expect(cyclic.status, `环没被 madge 判红（exit ${cyclic.status}）：\n${cyclic.out}`).not.toBe(0)
    expect(cyclic.out).toMatch(/circular/i)

    const acyclic = run({
      'a.ts': 'import { b } from \'./b\'\nexport const a = (): unknown => b\n',
      'b.ts': 'export const b = (): unknown => null\n',
    })
    expect(acyclic.status, `无环却判红了（exit ${acyclic.status}）：\n${acyclic.out}`).toBe(0)
    // 真起两次 madge：默认 5s 在「树很大 / turbo 同时跑别的包」时会假红（2026-11-03 实测 6.5s 超时）。
    // 这是集成型用例，超时是环境变量而不是断言信号。
  }, 30_000)

  it('每一段都写清了「凭什么」（理由不许敷衍）', () => {
    for (const gate of PREPUSH_GATES) {
      expect(gate.why.length, `${gate.id} 的理由太短`).toBeGreaterThan(25)
      expect(gate.label.length, `${gate.id} 的标签太短`).toBeGreaterThan(0)
    }
  })

  it('顺序与 id 稳定 —— 整表列出，不是抽样', () => {
    // 表里的顺序是「读起来该怎么理解」，不是依赖关系（并行跑）。改动它应该是**有意的**。
    expect(PREPUSH_GATES.map(g => g.id)).toEqual([
      'boundaries',
      'circular',
      'lint',
      'lint-root',
      'types',
      'types-root',
      'test',
      'syncpack',
      'workflows',
      'workflows-shell',
      'dynamic-imports',
      'docs-refs',
      'adr',
      'doc-ts',
      'doc-budget',
      'emoji',
      'seed',
      'openapi',
      'dts',
      'turbo-cache',
      'lockfile',
      'nginx-headers',
      'exports',
      'secrets',
      'pre-hooks',
      'versioning',
    ])
  })

  it('段数不是 0（空表 = 推送前什么都不跑，且不会有任何提示）', () => {
    expect(PREPUSH_GATES.length).toBeGreaterThan(5)
  })
})

describe('formatLine —— 结果行（三态）', () => {
  const gate = { id: 'x', label: '某段门禁', argv: ['x'], why: 'y'.repeat(30) }

  it('通过打 ✓、失败打 ✗，并带上秒数', () => {
    expect(formatLine({ gate, status: 'ok', ms: 1234, output: '' })).toBe('  ✓    1.2s  某段门禁')
    expect(formatLine({ gate, status: 'failed', ms: 12_340, output: '' })).toBe('  ✗   12.3s  某段门禁')
  })

  // 这一条是这次的**回归锚**：以前「跳过」与「通过」打的是同一个对勾（子进程 exit 0 + 只在失败时
  // 回放输出），于是推送者以为验过了。跳过必须有自己的标记，且必须在行尾写明「未验证」。
  it('跳过打 `-`，且行尾注明 [SKIP 未验证]（与通过、失败都不同形）', () => {
    const line = formatLine({ gate, status: 'skipped', ms: 1234, output: '' })
    expect(line).toBe('  -    1.2s  某段门禁  [SKIP 未验证]')
    expect(line).not.toContain('✓')
    expect(line).not.toContain('✗')
  })

  it('秒数右对齐（否则这一列参差不齐，正是要修的可读性问题）', () => {
    const short = formatLine({ gate, status: 'ok', ms: 900, output: '' })
    const long = formatLine({ gate, status: 'ok', ms: 12_300, output: '' })
    expect(short.indexOf('某段门禁')).toBe(long.indexOf('某段门禁'))
  })
})

/**
 * 三态的执行器分支。
 *
 * 为什么必须注入执行器：跳过只有在**子进程真的报退出码 3** 时才会出现，而现场卸载 actionlint
 * 不现实。注入之后这条分支才有真用例 —— 否则它只是一段谁也没跑过的代码。
 */
describe('runGates —— 三态（跳过既不算通过、也不算失败）', () => {
  const mkGate = (id: string) => ({ id, label: `段 ${id}`, argv: ['x'], why: 'y'.repeat(30) })

  it('正常返回 ⇒ ok', async () => {
    const results = await runGates([mkGate('a'), mkGate('b')], () => {}, 2, async () => {})
    expect(results.map(r => r.status)).toEqual(['ok', 'ok'])
  })

  it('抛 ChildRunError(…, 3) ⇒ skipped（「环境缺失、未验证」的唯一入口）', async () => {
    const results = await runGates([mkGate('a')], () => {}, 1, async (gate) => {
      throw new ChildRunError(`${gate.id} 未验证`, SKIPPED_EXIT_CODE)
    })
    expect(results.map(r => r.status)).toEqual(['skipped'])
  })

  it('抛别的非零退出码 ⇒ failed（1 违规 / 2 前置未满足都算失败，只有 3 是跳过）', async () => {
    const results = await runGates([mkGate('a'), mkGate('b'), mkGate('c')], () => {}, 3, async (gate) => {
      throw new ChildRunError(`${gate.id} 挂了`, gate.id === 'c' ? 2 : 1)
    })
    expect(results.map(r => r.status)).toEqual(['failed', 'failed', 'failed'])
  })

  it('混合时逐段分类，且结果顺序仍是表里的顺序（并行不影响断言）', async () => {
    const exitOf: Record<string, number> = { a: 0, b: SKIPPED_EXIT_CODE, c: 1 }
    const results = await runGates([mkGate('a'), mkGate('b'), mkGate('c')], () => {}, 3, async (gate) => {
      const code = exitOf[gate.id]!
      if (code !== 0)
        throw new ChildRunError(`${gate.id} 退出码 ${code}`, code)
    })
    expect(results.map(r => `${r.gate.id}:${r.status}`)).toEqual(['a:ok', 'b:skipped', 'c:failed'])
  })
})

describe('strictFailureMessage —— PREPUSH_STRICT 的口径', () => {
  it('默认（非严格）时，有跳过也不判红', () => {
    expect(strictFailureMessage(false, ['workflows'])).toBeNull()
  })

  it('严格模式下，没有跳过就不判红', () => {
    expect(strictFailureMessage(true, [])).toBeNull()
  })

  it('严格模式 + 有跳过 ⇒ 给出判红理由，且理由里点名了那几段', () => {
    const message = strictFailureMessage(true, ['workflows', 'workflows-shell'])
    expect(message).not.toBeNull()
    expect(message).toContain('PREPUSH_STRICT=1')
    expect(message).toContain('workflows, workflows-shell')
    expect(message).toContain('未验证')
  })
})

/**
 * 汇总口径：「跳过」必须在**成功汇总里也可见**。
 *
 * 这是本轮修复的验收判据本身 —— 以前成功时只有一句「N 段全部通过」，跳过段连名字都不出现。
 */
describe('summarizeRun —— 成功汇总里也要看得见「跳过」', () => {
  const gate = (id: string) => ({ id, label: `段 ${id}`, argv: ['x'], why: 'y'.repeat(30) })
  const result = (id: string, status: 'ok' | 'failed' | 'skipped') => ({ gate: gate(id), status, ms: 1000, output: '' })

  it('全都真跑通过：不出现「跳过」字样（没有跳过时那句是噪音）', () => {
    const summary = summarizeRun([result('a', 'ok'), result('b', 'ok')], '3.0', false)
    expect(summary.okLine).toBe('2 段：2 段真跑通过（总 3.0s）')
    expect(summary.okLine).not.toContain('跳过')
    expect(summary.skippedLine).toBeNull()
    expect(summary.strictMessage).toBeNull()
  })

  it('有跳过（其余全过）：汇总里报出跳过段数，且跳过段名单独一行', () => {
    const summary = summarizeRun([result('a', 'ok'), result('workflows', 'skipped')], '1.5', false)
    expect(summary.okLine).toBe('2 段：1 段真跑通过 / 1 段跳过（未验证）（总 1.5s）')
    expect(summary.okLine).not.toContain('全部通过')
    expect(summary.skippedLine).toContain('workflows')
    expect(summary.skippedLine).toContain('跳过不等于通过')
    // 默认（非严格）不判红：没装工具的机器不该被门禁挡住推送
    expect(summary.strictMessage).toBeNull()
  })

  it('严格模式 + 有跳过 ⇒ 同一份结果就要给出判红理由（口径唯一点）', () => {
    const summary = summarizeRun([result('a', 'ok'), result('workflows', 'skipped')], '1.5', true)
    expect(summary.strictMessage).toContain('PREPUSH_STRICT=1')
  })

  it('有失败时：failed 只含失败段，真跑通过数不把跳过算进去', () => {
    const summary = summarizeRun([
      result('a', 'ok'),
      result('b', 'failed'),
      result('workflows', 'skipped'),
    ], '2.0', false)
    expect(summary.failed.map(r => r.gate.id)).toEqual(['b'])
    expect(summary.skipped.map(r => r.gate.id)).toEqual(['workflows'])
    expect(summary.okLine).toBe('3 段：1 段真跑通过 / 1 段跳过（未验证）（总 2.0s）')
  })
})

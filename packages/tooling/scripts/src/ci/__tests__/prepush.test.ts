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
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { ChildRunError } from '../../lib/child-run.ts'
import { SKIPPED_EXIT_CODE } from '../../lib/errors.ts'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import {
  createPnpmGateExecutor,
  formatLine,
  GATE_BUDGET_MS,
  gateBudgetMs,
  PREPUSH_BUDGET_ENV,
  PREPUSH_GATES,
  runGates,
  strictFailureMessage,
  summarizeRun,
} from '../prepush.ts'

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

/**
 * 并行编排的两条**接线**判据 —— 它们都只存在于真执行路径上，纯函数测不到：
 * ① 一段超时只收**它自己**的进程树（兄弟段继续跑完并各自给出真实结论）；
 * ② 段表里的 `budgetMs` 真的变成该段的执行预算。
 *
 * 为什么不用假执行器：① 的现场在 `lib/child-run.ts` 的超时分支（它一度调用**无参**
 * `killActiveChild()` = 杀全部），② 的现场在 `createPnpmGateExecutor` 传不传
 * `budgetDefaultMs`。注入一个假执行器就把这两处全绕开了 —— 测到的只是「runGates 会不会调我」。
 * 所以这里注入 `bin: process.execPath`，把门禁段换成毫秒级的 `node -e` 命令：生产路径
 * （cwd / 预算 / 超时杀树 / 三态归类）一行不改，`turbo run lint` 一次都不跑。
 *
 * 负对照（各做过一次，见批次记录）：把 `killChildTree(child)` 改回 `killActiveChild()` ⇒
 * 「兄弟段被连带杀掉：…」红；把 `budgetDefaultMs: gateBudgetMs(gate)` 改回 `GATE_BUDGET_MS` ⇒
 * 预算那条用例红（那一段会跑满 6s 并通过）。
 */
describe('runGates + createPnpmGateExecutor —— 兄弟段互不牵连（真接线）', () => {
  /** 门禁段的 argv 会被**原样**交给注入的 bin ⇒ 一段 `node -e` 就是一段假门禁 */
  const fakeGate = {
    /** 占住不退出：模拟「这一段卡住了」（封顶 20s：真回归时别留一条 2 分钟的孤儿进程） */
    hang: ['-e', 'setTimeout(() => {}, 20_000)'],
    /** 跑满 `ms` 之后把 `marker` 写出来再退出 —— 文件存在 = 它真的自己跑完了（被杀不会有） */
    work: (ms: number, marker?: string): string[] => [
      '-e',
      marker === undefined
        ? `setTimeout(() => {}, ${ms})`
        : `setTimeout(() => { process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(marker)}, 'done') }, ${ms})`,
    ],
  }

  const mkGate = (id: string, argv: string[], budgetMs?: number) => ({
    id,
    label: `段 ${id}`,
    argv,
    why: 'y'.repeat(30),
    ...(budgetMs === undefined ? {} : { budgetMs }),
  })

  /**
   * 跑一段用例前先把 `PREPUSH_BUDGET_MS` 摘掉：它的优先级**高于**段表 budgetMs（整台机器一起
   * 放宽的入口），留着会让「这一段自己的预算」这类断言随机器环境漂移。退出时原样放回。
   */
  async function withoutBudgetEnv<T>(run: () => Promise<T>): Promise<T> {
    const saved = process.env[PREPUSH_BUDGET_ENV]
    delete process.env[PREPUSH_BUDGET_ENV]
    try {
      return await run()
    }
    finally {
      if (saved !== undefined)
        process.env[PREPUSH_BUDGET_ENV] = saved
    }
  }

  it('一段超时只收它自己的树：兄弟段继续跑完，并给出自己的真实结论', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'walnut-prepush-sibling-'))
    try {
      const marker = path.join(dir, 'survivor.txt')
      // 两段并发（concurrency = 2）：卡住那段 400ms 就超时，兄弟段要 3s —— 后者的**绝大部分**
      // 寿命都落在前者的「超时之后」。余量刻意留到 7 倍以上：win32 的 `taskkill` 走同步
      // `execFileSync`，实测能阻塞事件循环 1s+，余量小的话兄弟段可能在「全杀」落地前就自己跑完了
      // （假绿：那正是本用例要防的形态）。
      const results = await withoutBudgetEnv(() => runGates(
        [
          mkGate('stuck', fakeGate.hang, 400),
          mkGate('survivor', fakeGate.work(3_000, marker)),
        ],
        () => {},
        2,
        createPnpmGateExecutor({ bin: process.execPath }),
      ))
      const [stuck, survivor] = results

      // ① 卡住那段：它自己的失败，理由是**它自己**超时（不是「被信号结束」）
      expect(stuck!.status).toBe('failed')
      expect(stuck!.output).toContain('超时')

      // ② 兄弟段：跑完、绿，而且真的干完了活（marker 是它自己写的）
      expect(survivor!.status, `兄弟段被连带杀掉了：\n${survivor!.output}`).toBe('ok')
      expect(existsSync(marker), '兄弟段没跑完（marker 没写出来）—— 它的子进程被提前收掉了').toBe(true)

      // ③ 两段不该同时结束：真实现场是「四条结束时间精确到 0.1s 相同」，那正是被一起杀的指纹
      expect(survivor!.ms).toBeGreaterThan(stuck!.ms)
    }
    finally {
      // 自建的临时目录（os.tmpdir 下，不是仓库内容）
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('段表里的 budgetMs 真的收窄该段的预算（改回全局一刀切 ⇒ 这一段会跑满 6s 并通过）', async () => {
    const started = Date.now()
    const [result] = await withoutBudgetEnv(() => runGates(
      [mkGate('tight', fakeGate.work(6_000), 1_500)],
      () => {},
      1,
      createPnpmGateExecutor({ bin: process.execPath }),
    ))
    const elapsed = Date.now() - started

    expect(result!.status).toBe('failed')
    // 超时文案念的是**这一段**的预算（>2s = 1500ms 取整），不是全表的 600s
    expect(result!.output).toContain('超时（>2s）')
    // 判据是**时刻**：一刀切 600s 时这一段会跑满 6s 并通过（上一条先红），预算生效时 ~1.5s
    expect(elapsed).toBeLessThan(4_000)
  }, 30_000)

  it('环境变量 PREPUSH_BUDGET_MS 仍然覆盖全表：优先级高于段表 budgetMs（一处放宽/收紧的入口不许失效）', async () => {
    const saved = process.env[PREPUSH_BUDGET_ENV]
    process.env[PREPUSH_BUDGET_ENV] = '400'
    try {
      const started = Date.now()
      const [result] = await runGates(
        // 段表说 60s（宽松），环境变量说 400ms ⇒ 必须按环境变量收
        [mkGate('env-wins', fakeGate.work(3_000), 60_000)],
        () => {},
        1,
        createPnpmGateExecutor({ bin: process.execPath }),
      )
      expect(result!.status).toBe('failed')
      expect(Date.now() - started).toBeLessThan(2_500)
    }
    finally {
      if (saved === undefined)
        delete process.env[PREPUSH_BUDGET_ENV]
      else
        process.env[PREPUSH_BUDGET_ENV] = saved
    }
  }, 30_000)
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

/**
 * 单段预算：冷缓存实测之后调过的那一笔。
 *
 * 为什么值得钉：预算是**把在跑的段判死**的唯一入口。300s 在冷缓存 + 四路并发下会把
 * `lint` 段判超时（实测），而误判一次的代价是整轮假红、人开始绕过门禁 —— 那种失效不会报错。
 * 断言写成**判据**（相对实测值留 ≥2 倍余量）而不是写死 600000：以后往上调不会假红，
 * 往回调到 300s 会当场红。
 */
describe('单段预算 —— 冷缓存下不许把还在跑的段判死', () => {
  /** 冷缓存 + `PREPUSH_CONCURRENCY=4` 下实测越过的那条线（见 prepush.ts 的 GATE_BUDGET_MS 注释） */
  const COLD_CACHE_MEASURED_MS = 300_000

  it('默认预算至少是冷缓存实测值的 2 倍', () => {
    expect(GATE_BUDGET_MS).toBeGreaterThanOrEqual(COLD_CACHE_MEASURED_MS * 2)
  })

  it('覆盖入口是 PREPUSH_BUDGET_MS（超时提示行会把这个名字念给用户，改名等于让人无从调）', () => {
    expect(PREPUSH_BUDGET_ENV).toBe('PREPUSH_BUDGET_MS')
  })

  it('gateBudgetMs：段表 budgetMs 优先，缺省回落到 GATE_BUDGET_MS（方向写反 = 全表静默退回一刀切）', () => {
    const base = { id: 'x', label: 'x', argv: ['x'], why: 'y'.repeat(30) }
    expect(gateBudgetMs({ ...base, budgetMs: 1234 })).toBe(1234)
    expect(gateBudgetMs(base)).toBe(GATE_BUDGET_MS)
  })

  it('只有冷跑最慢的 lint / test 段有自己的预算，且 ≥ 2× 各自实测下界', () => {
    // 下界来自 batch-14 的 r3-review 逐段计时（冷缓存 + 四路并发抢 CPU），两段都是**被截断**的
    // 下界（理由见 prepush.ts 的 SLOW_GATE_BUDGET_MS 注释）。判据写成「≥ 2× 下界」而不是写死
    // 900000：往上调不会假红，往下调回接近实测值会当场红。
    const measuredFloor: Record<string, number> = { lint: 309_500, test: 241_500 }
    for (const [id, floor] of Object.entries(measuredFloor)) {
      const gate = PREPUSH_GATES.find(g => g.id === id)
      expect(gate, `${id} 段不见了 —— 门禁被摘`).toBeTruthy()
      expect(
        gate!.budgetMs,
        `${id} 段没有自己的预算 ⇒ 冷跑会被全局 ${GATE_BUDGET_MS / 1000}s 判死（实测下界 ${floor / 1000}s）`,
      ).toBeTypeOf('number')
      expect(gateBudgetMs(gate!), `${id} 段的预算不到实测下界的 2 倍`).toBeGreaterThanOrEqual(floor * 2)
    }
    // 其余段**不许**顺手放大：按段给预算的用途是「把慢段放开」，不是「全表偷偷放宽」
    for (const gate of PREPUSH_GATES) {
      if (gate.id === 'lint' || gate.id === 'test')
        continue
      expect(gate.budgetMs, `${gate.id} 段不该有自己的预算（它没有越过全局值的实测证据）`).toBeUndefined()
    }
  })
})

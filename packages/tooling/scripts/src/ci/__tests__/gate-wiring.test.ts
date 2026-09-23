/**
 * 「门禁接线」的反向断言 —— 补的是本仓唯一 0 覆盖率的接线面。
 *
 * **为什么需要它**：本仓有三张互不知情的清单 —— prepush 门禁表（`src/ci/prepush.ts`）、
 * 发版电池（`@walnut/release` 的 `RELEASE_BATTERY`）、CI 的 workflow 步骤。它们是同一批命令的
 * 三种排列，却**没有任何东西保证三者一致**：
 *
 *   · 删掉/改名一个根脚本 ⇒ workflow 里那句 `pnpm xxx` 会当场失败（还算响亮），
 *     但**发版电池里那句**要等到打 tag 前才炸；
 *   · 新增一段门禁却忘了接进 CI ⇒ **只有本地守**，而没有任何提示。
 *
 * 这类「静默少跑一项」正是本仓反复强调的失败形态（见 `prepush.ts` 顶部与
 * `AGENTS.md` 关键纪律 2）。参考仓把同类断言做成了双向核对；本文件是它的最小等价物。
 *
 * **判据刻意宽松**（宁可漏报不可误报）：
 *   · 只断言「引用的脚本**存在**」与「门禁至少出现在 CI 或电池之一」，
 *     **不比对顺序、不比对参数** —— CI 用的是 `pnpm exec turbo run lint --affected`
 *     这类带旗标的形态，逐字钉会频繁误红；
 *   · 发版电池与 prepush 表按**文本**读取（而非 import）：两者分属不同包，
 *     而本测试要守的正是「这两个文件里的字面量必须自洽」，读文本反而更贴近被守的对象。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PREPUSH_GATES } from '../prepush.ts'

/** 测试自己解析仓库根（vitest 下 `import.meta.dirname` 不可靠，不依赖被测模块的常量） */
function findRoot(start: string): string {
  let dir = path.resolve(start)
  for (;;) {
    if (path.basename(dir) === 'walnut-admin' && path.basename(path.dirname(dir)) === 'walnut-admin')
      return dir
    const up = path.dirname(dir)
    if (up === dir)
      throw new Error(`从 ${start} 向上找不到仓库根`)
    dir = up
  }
}
const ROOT = findRoot(process.cwd())
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const rootScripts = new Set(Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts))

/** pnpm 自己的子命令（它们不是根脚本，见 `prepush.test.ts` 的同一份白名单口径） */
const PNPM_SUBCOMMANDS = new Set([
  'exec',
  'install',
  'deploy',
  'change',
  'version',
  'run',
  'dlx',
  'add',
  'remove',
  'publish',
  'why',
  'outdated',
  'audit',
  'licenses',
  'list',
  'update',
  'patch',
  'rebuild',
  'store',
  'config',
  'root',
  'bin',
  'init',
  'prune',
  'import',
  'link',
  'pack',
  'recursive',
  'filter',
  'ci',
  'clean',
])

const WORKFLOW_DIR = '.github/workflows'
const workflows = readdirSync(path.join(ROOT, WORKFLOW_DIR)).filter(f => f.endsWith('.yml'))

/** workflow 里所有 `run:` 的正文，带 `文件:行号` 便于报错定位 */
function runCommands(): { file: string, line: number, cmd: string }[] {
  const out: { file: string, line: number, cmd: string }[] = []
  for (const f of workflows) {
    read(path.join(WORKFLOW_DIR, f)).split('\n').forEach((l, i) => {
      // 手写而不是正则：`^\s*(?:-\s*)?run:\s*(.*)$` 会被
      // `regexp/no-super-linear-backtracking` 判为可多项式回溯（本仓已有先例）
      const trimmed = l.trimStart()
      const body = trimmed.startsWith('- ') ? trimmed.slice(2).trimStart() : trimmed
      if (!body.startsWith('run:'))
        return
      const cmd = body.slice('run:'.length).trim()
      if (cmd !== '')
        out.push({ file: f, line: i + 1, cmd })
    })
  }
  return out
}

/** 从一条 shell 命令里挑出 `pnpm <脚本名>` 形态的引用 */
function pnpmScriptRefs(cmd: string): string[] {
  const found: string[] = []
  for (const m of cmd.matchAll(/\bpnpm(?:\.cmd)?\s+(?:-[\w-]+\s+)*([\w:.-]+)/g)) {
    const name = m[1]
    if (name && !name.startsWith('-') && !PNPM_SUBCOMMANDS.has(name))
      found.push(name)
  }
  return found
}

/** 发版电池里的 argv 首项（`RELEASE_BATTERY` 是 release 包内的常量，按文本读） */
function batteryArgvHeads(): string[] {
  const src = read(path.join('packages/tooling/release/src/release/steps.ts'))
  return [...src.matchAll(/argv: \[([^\]]+)\]/g)].map(m => m[1].replace(/['\s]/g, '').split(',')[0]!)
}

const ciText = workflows.map(f => read(path.join(WORKFLOW_DIR, f))).join('\n')
const batteryText = read(path.join('packages/tooling/release/src/release/steps.ts'))

describe('workflow 的 run: 不得引用不存在的根脚本', () => {
  it('全部能落到真实根脚本上', () => {
    const bad: string[] = []
    for (const { file, line, cmd } of runCommands()) {
      for (const name of pnpmScriptRefs(cmd)) {
        if (!rootScripts.has(name))
          bad.push(`${file}:${line} 引用了不存在的根脚本 \`${name}\``)
      }
    }
    expect(bad).toEqual([])
  })

  it('确实扫到了东西（空扫描面 = 断言失效，不是「全都对」）', () => {
    const refs = runCommands().flatMap(c => pnpmScriptRefs(c.cmd))
    // 这条防的是「正则写错 ⇒ 一个都没匹配到 ⇒ 上一条永远绿」
    expect(refs.length).toBeGreaterThan(8)
    expect(workflows.length).toBeGreaterThanOrEqual(4)
  })
})

/**
 * 触发面豁免表：**每条都必须写清理由**，且由下面的用例拦「清单腐化」
 * （键必须是真实门禁 id、理由不许敷衍）。没有豁免 = 断言更严。
 */
const CI_EXEMPT: Record<string, string> = {
  // actionlint 在 CI 侧由**专门的 workflow**直接下载并执行二进制（`workflow-lint.yml`），
  // 不经过 `pnpm lint:workflows` 这个包装脚本 —— 覆盖是有的，只是入口形态不同。
  workflows: 'CI 侧由 workflow-lint.yml 直接跑 actionlint 二进制，不经过 pnpm 包装脚本',
}

const BATTERY_EXEMPT: Record<string, string> = {}

describe('每一段 prepush 门禁都必须有 CI 与发版电池的触发面', () => {
  it('没有「只有本地守」的门禁（CI 侧）', () => {
    const missing: string[] = []
    for (const g of PREPUSH_GATES) {
      // argv 形如 ['exec','turbo','run','lint:root'] 或 ['lint:adr']
      const script = g.argv[0] === 'exec' ? g.argv[3] : g.argv[0]
      if (script === undefined || g.id in CI_EXEMPT)
        continue
      const inCi = ciText.includes(`pnpm ${script}`) || ciText.includes(`pnpm run ${script}`)
      if (!inCi)
        missing.push(`${g.id}（根脚本 \`${script}\`）不在任何 workflow 里 —— 它现在只有本地守`)
    }
    expect(missing).toEqual([])
  })

  it('发版电池是 prepush 的超集（发版面比 CI 面更宽是本仓刻意的口径）', () => {
    const missing: string[] = []
    for (const g of PREPUSH_GATES) {
      const script = g.argv[0] === 'exec' ? g.argv[3] : g.argv[0]
      if (script === undefined || g.id in BATTERY_EXEMPT)
        continue
      if (!batteryText.includes(`'${script}'`))
        missing.push(`${g.id}（根脚本 \`${script}\`）不在发版电池里`)
    }
    expect(missing).toEqual([])
  })

  it('豁免清单没有腐化：键必须是真实门禁 id，理由不许敷衍', () => {
    const ids = new Set(PREPUSH_GATES.map(g => g.id))
    for (const [k, why] of Object.entries({ ...CI_EXEMPT, ...BATTERY_EXEMPT })) {
      expect(ids.has(k), `豁免表里的 \`${k}\` 不是真实门禁 id（门禁已删或改名？）`).toBe(true)
      expect(why.length, `豁免 \`${k}\` 的理由太短，等于没写`).toBeGreaterThan(15)
    }
  })

  it('段数与根脚本名解析正常（防止解析退化后永远绿）', () => {
    expect(PREPUSH_GATES.length).toBeGreaterThan(8)
    for (const g of PREPUSH_GATES) {
      const script = g.argv[0] === 'exec' ? g.argv[3] : g.argv[0]
      expect(script, `${g.id} 的 argv 解析不出根脚本名：${g.argv.join(' ')}`).toBeTruthy()
    }
  })
})

describe('发版电池的引用也必须是真脚本', () => {
  it('每条 argv 的首项能落到根脚本或 pnpm 子命令', () => {
    const bad = batteryArgvHeads().filter(h => !rootScripts.has(h) && !PNPM_SUBCOMMANDS.has(h))
    expect(bad).toEqual([])
  })

  it('电池不是空的、且解析确实生效', () => {
    expect(batteryArgvHeads().length).toBeGreaterThan(10)
  })

  it('`hooks:check` 在电池里（它只能在「不经钩子」的入口生效，见 steps.ts 顶部注释）', () => {
    expect(batteryArgvHeads()).toContain('hooks:check')
  })
})

/**
 * `walnut-*` bin ↔ 根脚本 的二段跳。
 *
 * ⚠️ **为什么这是一条测试而不是一段 prepush 门禁**（2026-09-23 分析后下调的定位）：
 * 这个二段跳的失效模式**不是静默的** —— 根脚本指向不存在的 bin 时，`pnpm <script>` 会当场
 * `command not found` 非 0 退出；而「prepush 表里的 `argv[0]` 能不能落到真实根脚本」由
 * `prepush.test.ts` 已经在守。真正剩下的只有「孤儿 bin（声明了没有任何地方用）」这一项，
 * 为它新开一段门禁（外加四处接线）不划算。
 * 放在测试里则**零接线成本**就拿到了 CI 与发版电池两个触发面（两者都跑 `pnpm test`）。
 */
describe('bin ↔ 根脚本的二段跳', () => {
  const BIN_PACKAGES = ['packages/tooling/scripts', 'packages/tooling/release']

  const declaredBins = new Map<string, { dir: string, target: string }>()
  for (const dir of BIN_PACKAGES) {
    const pkg = JSON.parse(read(path.join(dir, 'package.json'))) as { bin?: Record<string, string> }
    for (const [name, target] of Object.entries(pkg.bin ?? {}))
      declaredBins.set(name, { dir, target: target.replace(/^\.\//, '') })
  }

  /** 根脚本正文里引用的 `walnut-*` */
  const referenced = new Set<string>()
  for (const cmd of Object.values(JSON.parse(read('package.json')).scripts as Record<string, string>)) {
    for (const m of cmd.matchAll(/\b(walnut-[\w-]+)/g)) referenced.add(m[1]!)
  }

  it('每个声明的 bin，其目标文件真实存在', () => {
    const missing = [...declaredBins]
      .filter(([, v]) => !existsSync(path.join(ROOT, v.dir, v.target)))
      .map(([n, v]) => `${n} → ${v.dir}/${v.target} 不存在`)
    expect(missing).toEqual([])
  })

  it('根脚本引用的每个 bin 都已声明（否则是拼错的 bin 名）', () => {
    const dangling = [...referenced].filter(r => !declaredBins.has(r))
    expect(dangling).toEqual([])
  })

  it('没有孤儿 bin（声明了但没有任何根脚本引用 = 死代码）', () => {
    const orphans = [...declaredBins.keys()].filter(b => !referenced.has(b))
    expect(orphans).toEqual([])
  })

  it('解析确实生效（两个集合都非空，防止正则写错后永远绿）', () => {
    expect(declaredBins.size).toBeGreaterThan(5)
    expect(referenced.size).toBeGreaterThan(5)
  })
})

/**
 * 根脚本的**形态**（待办 P1-18，来自交叉对比的 C3）。
 *
 * 参考仓用「白名单 + 形态正则 + 理由」三件套管它的脚本面；本仓**只搬前两段**：
 * ① 名字形态；② 值里不许出现 shell 连接子。它那三条 forbidden 与本仓语境无关，不搬。
 *
 * **为什么值里不许有连接子值得单列一条**：`package-scripts.md` 写着「根 scripts 保持
 * 一句话委托」「不写 mega-scripts」，但那是**散文约定、零判据** —— 而本仓恰好有过一次
 * 「11 段门禁写成一条 300+ 字符 `a && b && …`」的历史（第 16 批拆掉的），
 * 那正是这条要防的形态。判据是机械的：出现 `&&` / `||` / `;` / `|` 就红。
 *
 * ⚠️ 这里**不查**「每个值必须指向 bin / turbo / eslint」那种白名单 —— 本仓根脚本合法地
 * 直接调 `eslint` / `tsc` / `rimraf` / `syncpack` / `docker` / `cross-env` 等一大票工具，
 * 白名单会变成一份**要不停维护的名单**（参考仓自己也只对 `lint:*` 那一段收紧了）。
 * 只对 `lint:*` 收了紧：那一段是本仓的门禁面，形态必须收敛。
 */
describe('根脚本的形态（P1-18）', () => {
  const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>

  /** 小写 kebab，`:` 分段，无空段（`build:stage` / `lint:root:fix` / `check:deps:update` 都合法） */
  const NAME_SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?::[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/

  /** shell 里能把两条命令接起来的字符 —— 出现即说明它不再是「一句话委托」 */
  const CONNECTORS = [
    { token: '&&', why: '条件串联' },
    { token: '||', why: '条件串联' },
    { token: ';', why: '顺序串联' },
    { token: '|', why: '管道' },
  ]

  it('名字形态：小写 kebab + `:` 分段', () => {
    const bad = Object.keys(scripts).filter(n => !NAME_SHAPE.test(n))
    expect(bad, `这些根脚本名不符合形态：${bad.join(', ')}`).toEqual([])
  })

  it('值里不许出现 shell 连接子（`&&` / `||` / `;` / `|`）—— 这就是「一句话委托」的机械版本', () => {
    const bad: string[] = []
    for (const [name, cmd] of Object.entries(scripts)) {
      for (const { token, why } of CONNECTORS) {
        if (cmd.includes(token))
          bad.push(`\`${name}\` 的值里有 ${token}（${why}）：${cmd}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('`lint:*` 必须落到 eslint / turbo / `walnut-*` bin 三种形态之一（门禁面不许自由发挥）', () => {
    const bad: string[] = []
    for (const [name, cmd] of Object.entries(scripts)) {
      if (!name.startsWith('lint'))
        continue
      const head = cmd.split(/\s+/)[0]!
      const ok = head === 'eslint' || head === 'turbo' || head.startsWith('walnut-')
      if (!ok)
        bad.push(`\`${name}\` 的值是 \`${cmd}\` —— 首词既不是 eslint / turbo，也不是 walnut-* bin`)
    }
    expect(bad).toEqual([])
  })

  it('形态断言确实覆盖到了东西（防止 package.json 读错后变成空转）', () => {
    expect(Object.keys(scripts).length).toBeGreaterThan(30)
    expect(Object.keys(scripts).filter(n => n.startsWith('lint'))).toHaveLength(13)
  })

  it('负对照：形态正则与连接子判定本身是有效的', () => {
    // 正则不靠"当前恰好没有坏名字"来成立 —— 拿几个**故意坏**的名字验一遍
    for (const bad of ['Lint', 'lint::root', 'lint:Root', '-lint', 'lint:', 'lint_thing'])
      expect(NAME_SHAPE.test(bad), `\`${bad}\` 不该通过形态检查`).toBe(false)
    for (const good of ['lint', 'lint:root', 'lint:root:fix', 'check:deps:update', 'inspect:node-modules'])
      expect(NAME_SHAPE.test(good), `\`${good}\` 应该通过形态检查`).toBe(true)
    // 连接子判定：拿本仓历史上那个真实的坏形态验
    expect('a && b'.includes('&&')).toBe(true)
  })
})

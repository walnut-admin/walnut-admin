/**
 * 「推送前门禁」的**唯一门禁表** + 并行执行器。
 *
 * ## 为什么要有这个文件
 *
 * 在这之前，门禁是一条 `a && b && c && …` 的**单行 shell 串**写在根 `package.json` 的
 * `prepush` 里。两件事一起把它变成了维护负担：① 一行 300+ 字符，加一段得在中间找位置；
 * ② 同一份清单被**四处文档各抄一遍**（`AGENTS.md` / `README.md` / `package-scripts.md` /
 * ADR 0018）—— 正是本仓刚立的那条纪律「别在正文里写会腐烂的清单」的典型反例。
 *
 * 现在：**门禁表就是这个数组**，增删改都只看这一处；命令行只剩一个词 `pnpm prepush`
 * （= `walnut-prepush`）；文档只指向本文件。顺带拿到的两件事：
 *
 * - **并行**：表里绝大多数段是秒级的纯读盘检查，唯一的重活（`types:check`）以前只能排在
 *   它们后面干等。现在按有界并发跑，重活与轻活重叠。
 * - **每段耗时**：以前哪一段慢完全看不出来（`&&` 串只给一个总时间）。
 *
 * ## 为什么不搬进 `lefthook.yml`
 *
 * 曾经认真考虑过「pre-push 下写十几个 job」。**没搬的两个理由**：
 * ① `pnpm prepush` 这个名字被发版工具链引用着（`release/src/release/env.ts` 与
 *    `lib/child-run.ts` 都要在发版流程里剥掉 `LEFTHOOK*` 环境变量，否则发版时的 `git push`
 *    会递归触发它自己）—— 搬走等于让发版代码去认识一个钩子配置。
 * ② ADR 0018 给「收敛成单条命令」的理由（「被截断只会退化成命令不存在」）**是冲着旧
 *    simple-git-hooks 说的** —— 那时命令链真的被 postinstall 写进 `.git/hooks/*`。迁到 lefthook
 *    之后，生成的钩子文件里**一条门禁命令都没有**（它只是 `lefthook run "pre-push"` 的启动器），
 *    链进了跟踪面 —— 而 `lefthook.yml` 同样是跟踪面。那条理由在这儿已经不作数了。
 *
 * ## 顺序即执行顺序？不是
 *
 * 并行之后**完成顺序不等于表里的顺序**。表里的顺序表达的是「读起来该按什么顺序理解」，
 * 不是依赖关系 —— 表里各段之间**没有任何依赖**（都是只读检查，不产生产物给对方用）。
 * 哪天出现真有依赖的两段，就该把它们合成一段，而不是靠顺序兜。
 */

import process from 'node:process'
import { runArgs } from '../lib/child-run.ts'
import { getPnpmBin } from '../lib/pnpm-launcher.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

export interface PrepushGate {
  /** 稳定标识（出错信息、将来按名跑单段都用它） */
  id: string
  /** 人话标签（表里打印这一列） */
  label: string
  /** 经 `pnpm <argv...>` 执行 */
  argv: string[]
  /** 为什么它在**推送前**必须跑 —— 这一列是给人看的，也是「凭什么」 */
  why: string
}

/**
 * 推送前门禁表。**改动这张表就是改推送门禁**，所以每条都写清楚「凭什么」。
 *
 * 全是**只读**检查：不写工作区、不互产产物 ⇒ 因此可以并行（见文件头）。
 * 唯一有副作用的是最后那段 `change check` —— 它也只读 `pnpm-workspace.yaml` 与各 `package.json`。
 */
export const PREPUSH_GATES: readonly PrepushGate[] = [
  {
    id: 'boundaries',
    label: '架构边界（turbo boundaries）',
    argv: ['boundaries'],
    why: '包之间的依赖方向由 tags 声明。违规一旦合并进去，纠正成本远高于拦在推送前。',
  },
  {
    id: 'lint-root',
    label: 'lint 根级配置（turbo run //#lint:root）',
    // 走 turbo 而不是直接 `pnpm lint:root`：根任务有精确的 inputs（就是脚本里那三个 glob），
    // 没改根级文件时命中缓存 —— 实测冷跑 3.8s / 热跑 0.1s（以前每次 push 都真跑 12s 上下）。
    argv: ['exec', 'turbo', 'run', 'lint:root'],
    why: '根级文件（`eslint.config.ts` / `knip.config.ts` / `package.json` / `pnpm-workspace.yaml`）**不在任何包的 lint 范围里**（它们不进 turbo 的包图），所以必须单独一段。',
  },
  {
    id: 'types',
    label: '类型检查（不排任何包）',
    argv: ['exec', 'turbo', 'run', 'types:check'],
    why: '唯一的重活。它必须**不排包**地跑 —— 排包会让「被改动的包依赖的包」漏检。',
  },
  {
    id: 'types-root',
    label: '根级配置类型检查（pnpm types:check:root）',
    argv: ['types:check:root'],
    why: '与 `lint:root` 同理：根 `tsconfig.json` 覆盖的那几个配置**不入 turbo 的图**，没有这一段就没人检查它们的类型。',
  },
  {
    id: 'syncpack',
    label: '依赖一致性（syncpack）',
    argv: ['syncpack:lint'],
    why: 'workspace 内部引用必须是 `workspace:*`、版本必须走 catalog。版本漂移在发版时才炸，代价高。',
  },
  {
    id: 'workflows',
    label: 'workflow 校验（actionlint）',
    argv: ['lint:workflows'],
    why: '`.github/workflows` 只被 GitHub 在**真正触发时**校验 —— 一个非法表达式能让整条流水线「启动即失败、0 个 job」，本地不拦就只能在 push 后发现。',
  },
  {
    id: 'docs-refs',
    label: '文档引用校验（包名 / 仓库路径）',
    argv: ['lint:docs-refs'],
    why: '活文档正文里引用的包名与仓库路径必须真实存在。VitePress 内置只查 markdown 链接语法，反引号里的引用它看不见。',
  },
  {
    id: 'adr',
    label: 'ADR 形态校验（编号 / 状态 / 小节）',
    argv: ['lint:adr'],
    why: 'ADR 的编号连续、`Status` 在枚举内、四个必需小节齐备、`index.md` 双向对齐 —— 没有任何现成工具管这件事。',
  },
  {
    id: 'doc-ts',
    label: '文档代码块校验（ts 块必须能解析）',
    argv: ['lint:doc-ts'],
    why: '标成 `ts` 的围栏块必须能按 TypeScript 解析（JSON 别标成 `ts`、别截断/乱码）。这类块坏掉时读者看到的语法高亮全错，但构建不会报。',
  },
  {
    id: 'doc-budget',
    label: '文档字数预算（常驻文件不许膨胀）',
    argv: ['lint:doc-budget'],
    why: '根 `AGENTS.md` / `CLAUDE.md` / 包级指引是**每次会话都进上下文**的常驻内容，膨胀了会挤掉别的东西；预算用不到一半同样算失败（那种预算已经失效）。',
  },
  {
    id: 'turbo-cache',
    label: 'turbo 配置不变量（缓存边界 + tags）',
    argv: ['lint:turbo-cache'],
    why: 'turbo.json 里漏一个产物目录、少挂一条依赖边、tags 写错一个字符，症状全是**静默的** —— `FULL TURBO` + exit 0，但门禁回放了旧结论，或那个包**根本没被 boundaries 检查**。2026-09-23 实测到前者（`pnpm build:stage` 报成功却一个文件都没产出）。',
  },
  {
    id: 'lockfile',
    label: 'catalog 与锁文件锁步（catalog ↔ pnpm-lock）',
    argv: ['lint:lockfile'],
    why: '「升级依赖」在本仓 = 改 catalog 一行，而改了声明忘了 `pnpm install` 时**本地必然全绿**（所有门禁都用既有 node_modules）、**CI 必然红**（`--frozen-lockfile`），连打 tag 的发版面一起炸。这是唯一看得见它的地方。',
  },
  {
    id: 'nginx-headers',
    label: '入口 nginx 安全响应头（conf.d）',
    argv: ['lint:nginx-headers'],
    why: 'nginx 的 `add_header` 是**整段替换**不是合并：某个 location 自己写了一条，就把 server 级的 4 个安全头全吃掉；两个并列的 `server` 块之间也不互相继承（2026-09-23 实测 `api.conf` 一个头都没有）。本机没有 Docker ⇒ `nginx -t` 都跑不了，这是唯一在推送前能看见它的地方。',
  },
  {
    id: 'secrets',
    label: '源码密钥形态（凭据形状不许进仓库）',
    argv: ['lint:secrets'],
    why: '**服务端那道闸在 CI 之前**：GitHub 的 push protection 只认形状、分不出样本与真货，命中就拒掉整条 push。2026-09-23 实测被它拦下一次（一个测试夹具里写了云厂商样本 SecretId），而当时那段门禁表**全绿** —— 只在 CI 里拦等于没有，必须在推送前。',
  },
  {
    id: 'versioning',
    label: 'workspace 版本锁步（pnpm change check）',
    argv: ['change', 'check'],
    why: '单一 fixed 组的成员必须**恒等于**「有 version 的包数」。新增包忘了加进组，会让发版在打 tag 之前失败。',
  },
]

/** 有界并发：门禁多是秒级的读盘活，但 `types:check` 会吃满 CPU，开太多只会互相拖。 */
const DEFAULT_CONCURRENCY = 4

/** 单段预算：门禁都是分钟以内的活；真卡住要能自己收掉，而不是拖住整次 push。 */
const GATE_BUDGET_MS = 5 * 60_000

export interface GateResult {
  gate: PrepushGate
  ok: boolean
  ms: number
  /** 捕获到的完整输出（并行下不直接转播，避免多路输出交织） */
  output: string
}

/**
 * 有解并发地跑门禁表，**按完成顺序**回调（并行下没有「表里的顺序」可言）。
 * 返回全部结果（仍然按表里的顺序排列，便于断言与汇总）。
 */
export async function runGates(
  gates: readonly PrepushGate[],
  onDone: (result: GateResult) => void,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<GateResult[]> {
  const results = new Map<string, GateResult>()
  let next = 0
  // ⚠️ Windows 上不能直接 `spawn('pnpm', …)`：PATH 上是 `pnpm.cmd`，而 `shell: false` 下 Node 24
  // 不再把 `.cmd` 当可执行文件解析 ⇒ ENOENT（实测）。走 lib/pnpm-launcher.ts 找那个真 exe，
  // 它同时保证 argv 不经 cmd.exe（`%VAR%` / `&` 不会被展开）。
  const pnpmBin = getPnpmBin()

  async function worker(): Promise<void> {
    while (next < gates.length) {
      const gate = gates[next++]
      if (!gate)
        return
      const started = Date.now()
      const chunks: string[] = []
      let ok = true
      try {
        await runArgs(pnpmBin, gate.argv, {
          // ⚠️ cwd 必须是**仓库根**：从子目录跑时 `pnpm <脚本>` 会解析到最近那个包的脚本
          cwd: REPO_ROOT,
          // 并行下不转播子进程输出（多路交织会糊成一片）；收进缓冲，失败时整段回放
          output: { write: text => chunks.push(text) },
          // 探针（`$ pnpm …` 与心跳）也静音 —— 执行器自己会打印一行结果
          note: () => {},
          heartbeatMs: 0,
          budgetDefaultMs: GATE_BUDGET_MS,
        })
      }
      catch (error) {
        ok = false
        chunks.push(error instanceof Error ? error.message : String(error))
      }
      const result: GateResult = { gate, ok, ms: Date.now() - started, output: chunks.join('') }
      results.set(gate.id, result)
      onDone(result)
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, gates.length)) }, () => worker()),
  )
  return gates.map(gate => results.get(gate.id)!).filter(Boolean)
}

/** 结果表格里的一行（纯函数，便于用例断言） */
export function formatLine(result: GateResult): string {
  const mark = result.ok ? '✓' : '✗'
  const secs = `${(result.ms / 1000).toFixed(1)}s`
  return `  ${mark} ${secs.padStart(7)}  ${result.gate.label}`
}

export async function main(): Promise<number> {
  const concurrency = Math.max(1, Number(process.env.PREPUSH_CONCURRENCY) || DEFAULT_CONCURRENCY)
  const started = Date.now()
  console.log(`推送前门禁：${PREPUSH_GATES.length} 段，最多并行 ${concurrency} 路（表在 packages/tooling/scripts/src/ci/prepush.ts）`)

  const results = await runGates(PREPUSH_GATES, result => console.log(formatLine(result)), concurrency)
  const failed = results.filter(r => !r.ok)
  const total = ((Date.now() - started) / 1000).toFixed(1)

  if (failed.length === 0) {
    console.log(`✅ ${results.length} 段全部通过（总 ${total}s）`)
    return 0
  }

  // 失败才回放输出：成功时那些输出没人看，失败时它是唯一线索
  for (const result of failed) {
    console.error(`\n${'─'.repeat(20)} ${result.gate.label} 失败（${(result.ms / 1000).toFixed(1)}s） ${'─'.repeat(20)}`)
    console.error(`为什么必须有这一段：${result.gate.why}`)
    console.error(result.output.trimEnd() || '（这一段没有输出，只有非零退出码）')
  }
  console.error(`\n✖ ${failed.length}/${results.length} 段失败：${failed.map(r => r.gate.id).join(', ')}（总 ${total}s）`)
  return 1
}

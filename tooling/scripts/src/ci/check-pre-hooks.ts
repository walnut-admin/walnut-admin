// 「脚本前置钩子」门禁：**谁读生成物，谁负责先生成**。
//
// **为什么需要它**（2026-09-24 真实事故）：admin 那两个 unplugin 的 dts 是**生成物**（gitignored），
// 而 `vite` / `vue-tsc` 都要读它们。把生成物移出跟踪面那次，我只给 `dev` 与 `types:check` 接了生成
// 步骤，**漏了 `build`** —— 打包时 vite-plugin-checker 在插件写盘**之前**就建好了 TS program，
// 于是 CI 的 `Build admin` 报了一串 `Cannot find name 'useAppStore…'` 直接失败。
// （本地复现判据：把该包的生成物移走、**不经** pre 钩子直接 `vue-tsc`，报的就是同一批名字。）
//
// **判据**（机械、零猜测）：
//   ① 一个包**有没有生成物**，由它有没有 `build/generate/` 目录决定 —— 没有这个目录的包
//      （例如 `@walnut/contract`，它也跑 `vite build`）**完全不管**：判据必须来自包自己，
//      否则这条门禁第一天就会在别的包上误报，而误报的门禁等于没有门禁；
//   ② 有生成物的包，凡是命令里跑「消费者」的脚本都必须有 `pre<script>` 钩子；
//      **消费者名单是数据、不是代码**：见同目录 ./pre-hook-consumers.ts（唯一真源），
//      新增消费者只改那份数据（连同 `why` 与例外子命令），门禁逻辑不动；
//   ③ 消费者的例外子命令（如 `vite preview`）除外 —— 它伺服的是**已构建**的产物，不读生成物；
//   ④ 钩子里若写了 `node <文件>`，那个文件必须真实存在（防「改名之后钩子指向空气」，
//      那会让这一步静默失效 —— 与本仓 `prepush.test.ts` 守的是同一类失败）。
import type { PreHookConsumer } from './pre-hook-consumers.ts'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { ViolationError } from '../lib/errors.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'
import { workspacePackages } from '../lib/workspace.ts'
import { PRE_HOOK_CONSUMERS } from './pre-hook-consumers.ts'

export interface Finding {
  /** 不变量编号，报错时好定位 */
  rule: string
  detail: string
}

/** 「消费者」的文案（从数据派生，避免文案与名单脱节） */
const CONSUMER_NAMES = PRE_HOOK_CONSUMERS.map((c) => c.bin).join(' / ')

/** 例外子命令的文案（同样从数据派生） */
const EXEMPT_NAMES = PRE_HOOK_CONSUMERS.flatMap((c) =>
  (c.exemptSubcommands ?? []).map((sub) => `\`${c.bin} ${sub}\``),
).join(' / ')

/** 这个包有没有「必须先跑」的生成物（判据 = 有没有 `build/generate/` 目录） */
const GENERATOR_DIR = 'build/generate'

/** 剥掉 `cross-env` 与 `KEY=value` 这些前缀，拿到真正要执行的命令 */
export function execTokens(command: string): string[] {
  const tokens = command.trim().split(/\s+/)
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!
    if (token === 'cross-env' || /^[A-Z_][A-Z0-9_]*=/.test(token)) {
      i += 1
      continue
    }
    break
  }
  return tokens.slice(i)
}

export interface PackageFacts {
  /** 报告里怎么称呼这个包（包名优先） */
  label: string
  scripts: Record<string, string>
  /** 包内是否存在 `build/generate/` */
  hasGenerators: boolean
  /** 路径是否存在（相对包目录）；由调用方注入，用例才好造「钩子指向空气」 */
  fileExists: (rel: string) => boolean
}

/** 这个包里 `name` 是不是某条脚本的生命周期钩子（`pre<X>` / `post<X>`，且 `X` 真的存在） */
function isLifecycleHook(name: string, scripts: Record<string, string>): boolean {
  const inner = /^(?:pre|post)(.+)$/.exec(name)?.[1]
  return inner !== undefined && Object.hasOwn(scripts, inner)
}

/** 纯逻辑：一个包的 scripts 里有哪些违反本门禁的地方（消费者名单可注入，默认取数据文件） */
export function findingsForPackage(
  facts: PackageFacts,
  consumers: readonly PreHookConsumer[] = PRE_HOOK_CONSUMERS,
): Finding[] {
  // ① 没有生成物的包不管 —— 它跑消费者也读不到什么"还没生成"的东西
  if (!facts.hasGenerators) return []

  // 查表：bin ⇒ 该消费者（连带它的例外子命令与理由）
  const consumerByBin = new Map(consumers.map((c) => [c.bin, c]))

  const findings: Finding[] = []
  for (const [name, command] of Object.entries(facts.scripts)) {
    // `pre*` / `post*` 自己不是入口（只有入口才需要钩子）
    if (isLifecycleHook(name, facts.scripts)) continue

    const tokens = execTokens(command)
    const bin = tokens[0]
    if (bin === undefined) continue
    const consumer = consumerByBin.get(bin)
    if (consumer === undefined) continue
    // ③ 例外子命令伺服的是已构建产物（`vite preview` 这类；名单在数据里）
    const subcommand = tokens[1]
    if (subcommand !== undefined && consumer.exemptSubcommands?.includes(subcommand)) continue

    const hook = facts.scripts[`pre${name}`]
    if (hook === undefined) {
      findings.push({
        rule: 'consumer-script-needs-pre-generate',
        detail: `${facts.label} 的 \`${name}\`（\`${command}\`）会读生成物，却没有 \`pre${name}\` 钩子 —— 生成物是 gitignored 的、干净检出里不存在，而这个消费者可能在它被写出来**之前**就读它（2026-09-24 \`Build admin\` 正是这么挂的）`,
      })
      continue
    }

    // ④ 钩子里写了 `node <文件>` ⇒ 那个文件必须在
    const target = /(?:^|\s)node\s+(\S+)/.exec(hook)?.[1]
    if (target !== undefined && !target.startsWith('-') && !facts.fileExists(target)) {
      findings.push({
        rule: 'pre-hook-target-exists',
        detail: `${facts.label} 的 \`pre${name}\` 指向 \`${target}\`，但那个文件不存在 —— 这一步会以「找不到文件」失败，或者更糟：看起来接了生成、其实没有`,
      })
    }
  }
  return findings
}

export function collectFindings(cwd = REPO_ROOT): Finding[] {
  const findings: Finding[] = []
  for (const pkg of workspacePackages()) {
    const dir = path.join(cwd, pkg.dir)
    findings.push(
      ...findingsForPackage({
        label: pkg.manifest.name ?? pkg.dir,
        scripts: pkg.manifest.scripts ?? {},
        hasGenerators: existsSync(path.join(dir, GENERATOR_DIR)),
        fileExists: (rel) => existsSync(path.join(dir, rel)),
      }),
    )
  }
  return findings
}

export function main(): void {
  const findings = collectFindings()

  if (findings.length === 0) {
    line('ok', `脚本前置钩子：有生成物的包，跑 ${CONSUMER_NAMES} 的脚本都接了生成步骤`)
    out(
      `  （判据：包内有 \`build/generate/\` ⇒ 它的 ${CONSUMER_NAMES} 脚本必须有 \`pre<script>\`${EXEMPT_NAMES === '' ? '' : `；${EXEMPT_NAMES} 除外`}）`,
    )
    return
  }

  lineErr('violation', `脚本前置钩子有 ${findings.length} 处问题：\n`)
  for (const f of findings) err(`  [${f.rule}] ${f.detail}`)
  err('\n判据见 tooling/scripts/src/ci/check-pre-hooks.ts；')
  err('消费者名单（唯一真源，新增消费者只改它）见 tooling/scripts/src/ci/pre-hook-consumers.ts；')
  err(
    '这次事故的来龙去脉见 apps/docs/src/zh-CN/content/monorepo/architecture-todo.md 的 2026-09-24 执行记录',
  )
  throw new ViolationError(`脚本前置钩子有 ${findings.length} 处问题（明细见上）`)
}

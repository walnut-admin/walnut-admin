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
//   ② 有生成物的包，凡是命令里跑 `vite` / `vue-tsc` 的脚本都必须有 `pre<script>` 钩子；
//   ③ `vite preview` 除外 —— 它伺服的是**已构建**的产物，不读生成物；
//   ④ 钩子里若写了 `node <文件>`，那个文件必须真实存在（防「改名之后钩子指向空气」，
//      那会让这一步静默失效 —— 与本仓 `prepush.test.ts` 守的是同一类失败）。
import { existsSync } from 'node:fs'
import path from 'node:path'

import { ViolationError } from '../lib/errors.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'
import { workspacePackages } from '../lib/workspace.ts'

export interface Finding {
  /** 不变量编号，报错时好定位 */
  rule: string
  detail: string
}

/** 会读生成物的命令（取「第一个非环境包装词」来比对） */
const CONSUMERS = new Set(['vite', 'vue-tsc'])

/** 例外：`vite preview` 伺服已构建的产物，不读生成物 */
const EXEMPT_SUBCOMMAND = 'preview'

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

/** 纯逻辑：一个包的 scripts 里有哪些违反本门禁的地方 */
export function findingsForPackage(facts: PackageFacts): Finding[] {
  // ① 没有生成物的包不管 —— 它跑 vite 也读不到什么"还没生成"的东西
  if (!facts.hasGenerators)
    return []

  const findings: Finding[] = []
  for (const [name, command] of Object.entries(facts.scripts)) {
    // `pre*` / `post*` 自己不是入口（只有入口才需要钩子）
    if (isLifecycleHook(name, facts.scripts))
      continue

    const tokens = execTokens(command)
    const consumer = tokens[0]
    if (consumer === undefined || !CONSUMERS.has(consumer))
      continue
    // ③ `vite preview` 伺服已构建产物
    if (tokens[1] === EXEMPT_SUBCOMMAND)
      continue

    const hook = facts.scripts[`pre${name}`]
    if (hook === undefined) {
      findings.push({
        rule: 'vite-script-needs-pre-generate',
        detail: `${facts.label} 的 \`${name}\`（\`${command}\`）会读生成物，却没有 \`pre${name}\` 钩子 —— 生成物是 gitignored 的、干净检出里不存在，而 vite 的检查器可能在它被写出来**之前**就读它（2026-09-24 \`Build admin\` 正是这么挂的）`,
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
    findings.push(...findingsForPackage({
      label: pkg.manifest.name ?? pkg.dir,
      scripts: pkg.manifest.scripts ?? {},
      hasGenerators: existsSync(path.join(dir, GENERATOR_DIR)),
      fileExists: rel => existsSync(path.join(dir, rel)),
    }))
  }
  return findings
}

export function main(): void {
  const findings = collectFindings()

  if (findings.length === 0) {
    line('ok', '脚本前置钩子：有生成物的包，跑 vite / vue-tsc 的脚本都接了生成步骤')
    out('  （判据：包内有 `build/generate/` ⇒ 它的 vite / vue-tsc 脚本必须有 `pre<script>`；`vite preview` 除外）')
    return
  }

  lineErr('violation', `脚本前置钩子有 ${findings.length} 处问题：\n`)
  for (const f of findings) err(`  [${f.rule}] ${f.detail}`)
  err('\n判据见 packages/tooling/scripts/src/ci/check-pre-hooks.ts；')
  err('这次事故的来龙去脉见 apps/docs/src/zh-CN/content/monorepo/architecture-todo.md 的 2026-09-24 执行记录')
  throw new ViolationError(`脚本前置钩子有 ${findings.length} 处问题（明细见上）`)
}

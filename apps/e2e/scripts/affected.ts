/**
 * `e2e:affected`：按 `git diff --name-only <base>...HEAD` 选择 E2E 子集。
 *
 * 分工：
 * - 映射规则在 `scripts/affected-plan.ts`（纯函数、有单测）；
 * - 这里只做 git 读取、打印计划、**经 `scripts/run.ts` 执行** —— 抢 run 级锁、preflight、
 *   基线决策与 `playwright test` 的硬顺序全部保持不变（不变量 6）；
 * - `--base` 参数化，默认 `origin/main`；引用不存在时按前置条件失败（退出码 2）并给出修复建议。
 *
 * 安全网：任何未映射的路径 → 全量。`affected` **不进任何 PR 门禁**，是本地 / nightly 的辅助入口。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { classifyAffectedPaths, describeAffectedPlan } from './affected-plan.ts'
import { E2E_ROOT, REPO_ROOT } from './env.ts'
import { E2ePreconditionError, reportFailure } from './failure.ts'

const DEFAULT_BASE = 'origin/main'

const USAGE = [
  '用法：node scripts/affected.ts [base] [--base <ref>]',
  '',
  `  base 默认 ${DEFAULT_BASE}；也可用 --base=<ref> 或位置参数。`,
  '  只打印计划；有需要跑的用例时经 scripts/run.ts 执行（抢锁 / 基线 / webServer 不变）。',
  '  未映射的改动一律回退全量（安全网）。',
].join('\n')

function gitOutput(args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

/** 解析 base（`--base <ref>` / `--base=<ref>` / 第一个位置参数；`--help` 单独返回） */
function parseBase(argv: readonly string[]): { base: string, help: boolean } {
  let base = DEFAULT_BASE
  let help = false

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--base') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new E2ePreconditionError('--base 需要一个 git ref（如 origin/main、main 或提交 sha）')
      }
      base = value
      index++
      continue
    }
    if (arg.startsWith('--base=')) {
      const value = arg.slice('--base='.length)
      if (value === '') {
        throw new E2ePreconditionError('--base= 后面需要一个 git ref')
      }
      base = value
      continue
    }
    if (!arg.startsWith('-')) {
      base = arg
      continue
    }
    throw new E2ePreconditionError(`不认识的参数「${arg}」\n${USAGE}`)
  }

  return { base, help }
}

/** base 必须是可解析的 commit-ish；缺失时给出与默认值相关的明确处置。 */
function assertBaseExists(base: string): void {
  try {
    gitOutput(['rev-parse', '--verify', '--quiet', `${base}^{commit}`])
  }
  catch {
    throw new E2ePreconditionError(
      `找不到 base 引用「${base}」。默认 base 是 ${DEFAULT_BASE}：先 \`git fetch origin main\`，`
      + '或用 `--base <ref>` 指定一个存在的分支 / tag / 提交 sha（浅克隆还需 `git fetch --unshallow`）。',
    )
  }
}

function readChangedPaths(base: string): string[] {
  try {
    return gitOutput(['diff', '--name-only', `${base}...HEAD`])
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line !== '')
  }
  catch (error) {
    throw new E2ePreconditionError(
      `读不到 ${base}...HEAD 的改动：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function main(): void {
  const { base, help } = parseBase(process.argv.slice(2))
  if (help) {
    console.log(USAGE)
    return
  }

  assertBaseExists(base)
  const changedPaths = readChangedPaths(base)
  const plan = classifyAffectedPaths(changedPaths)

  console.log(`[e2e/affected] base=${base}，改动 ${changedPaths.length} 个文件`)
  for (const changedPath of changedPaths) {
    console.log(`  - ${changedPath}`)
  }
  console.log(`[e2e/affected] 判定：${describeAffectedPlan(plan)}`)

  if (plan.mode === 'skip') {
    return
  }

  const args = plan.mode === 'projects'
    ? plan.projects.map(project => `--project=${project}`)
    : []
  if (plan.rebuild) {
    args.push('--rebuild-baseline')
  }

  console.log(`[e2e/affected] 执行：node scripts/run.ts ${args.join(' ')}`.trimEnd())
  const result = spawnSync(process.execPath, [path.join(E2E_ROOT, 'scripts/run.ts'), ...args], {
    cwd: E2E_ROOT,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error !== undefined && result.error !== null) {
    throw result.error
  }
  process.exitCode = result.status ?? 1
}

try {
  main()
}
catch (error) {
  process.exitCode = reportFailure('e2e/affected', error)
}

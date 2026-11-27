/**
 * `.e2e/` 运行态目录的清理入口：**dry-run 是默认**，`--force` 才真删。
 *
 * 为什么需要它：`apps/e2e/.e2e/` 是 gitignored 的排障现场，调试脚本、日志、截图、trace、
 * 临时 json 会越堆越多（`ls` 已经要翻好几屏），而**其中的基线三件套与 stack.json 是下一轮
 * run 直接消费的** —— 一把 `rm -rf .e2e` 会把封板成果连同证据一起删掉，下一次 run 退回
 * 全量 prepare。所以这里用白名单反过来做：只保留已知的四个「活文件」，其余全部列出 /
 * 清理；默认只打印计划，让人先看一眼。
 *
 * **profile 目录（P1-6）**：命名 profile 的活文件在 `.e2e/<profile>/` 里。清理会**递归**进
 * `smoke` / `risk` / `network` 三个目录，同样保留它们的基线三件套与 stack.json —— 一次
 * `e2e:clean` 不会毁掉别的 profile 的封板成果。
 *
 * 保留项（缺一不可，见 README「测试库封板」与「排障」）：
 * - `baseline.dump` / `baseline.manifest.json` / `baseline.credentials.json` —— 封板三件套；
 * - `stack.json` —— 上一轮 run 的栈信息（排障先看的那一份）。
 *
 * 不做的事：不碰 `.auth/`（`credentials.json` 是登录凭据、`gate-report.json` 是 auth.setup
 * 的产物）、不碰 `test-results/` / `playwright-report/`（Playwright 自己的产物目录，按
 * `playwright-report --ui` 的节奏管理），也不抢 run 级锁 —— 但**跑用例期间别清**：
 * 正在写的日志会被删。
 */
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  ARTIFACT_DIR,
  BASELINE_CREDENTIALS_FILE,
  BASELINE_DUMP_FILE,
  BASELINE_MANIFEST_FILE,
  STACK_INFO_FILE,
} from './env.ts'
import { NAMED_STACK_PROFILES, STACK_PROFILES } from './stack-profiles.ts'

/** 保留项（逐字与 env.ts 的常量对齐；这里存 basename，判据是「条目的 basename」） */
export const KEPT_ARTIFACTS: readonly string[] = [
  path.basename(BASELINE_DUMP_FILE),
  path.basename(BASELINE_MANIFEST_FILE),
  path.basename(BASELINE_CREDENTIALS_FILE),
  path.basename(STACK_INFO_FILE),
]

/** 命名 profile 的基线子目录名（`.e2e/smoke` 等；清理会递归进去但保留活文件） */
export const PROFILE_ARTIFACT_DIRS: readonly string[] = NAMED_STACK_PROFILES.map((name) =>
  path.basename(STACK_PROFILES[name].artifactDir),
)

export interface CleanEntry {
  /** 绝对路径 */
  path: string
  name: string
  kind: 'file' | 'dir'
  /** 文件本身的字节数；目录是递归合计 */
  bytes: number
  /** 目录里的文件数（文件恒为 1） */
  files: number
}

export interface CleanPlan {
  dir: string
  removable: CleanEntry[]
  kept: string[]
  removableBytes: number
  removableFiles: number
}

/** 递归统计目录（不跟随符号链接；坏链接按 0 字节的文件算） */
function measure(target: string): { bytes: number; files: number } {
  const info = lstatSync(target)
  if (!info.isDirectory()) {
    return { bytes: info.size, files: 1 }
  }
  let bytes = 0
  let files = 0
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name)
    const measured = measure(child)
    bytes += measured.bytes
    files += measured.files
  }
  return { bytes, files }
}

/** 生成清理计划（纯读取；不删任何东西；命名 profile 子目录递归、保留活文件） */
export function buildCleanPlan(dir = ARTIFACT_DIR): CleanPlan {
  if (!existsSync(dir)) {
    return { dir, removable: [], kept: [], removableBytes: 0, removableFiles: 0 }
  }

  const removable: CleanEntry[] = []
  const kept: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (KEPT_ARTIFACTS.includes(entry.name)) {
      kept.push(entry.name)
      continue
    }

    const target = path.join(dir, entry.name)
    // 命名 profile 目录：递归一层，同样只保留基线三件套与 stack.json（名称带 profile 前缀）
    if (entry.isDirectory() && PROFILE_ARTIFACT_DIRS.includes(entry.name)) {
      for (const child of readdirSync(target, { withFileTypes: true })) {
        if (KEPT_ARTIFACTS.includes(child.name)) {
          kept.push(`${entry.name}/${child.name}`)
          continue
        }
        const childPath = path.join(target, child.name)
        const measured = measure(childPath)
        removable.push({
          path: childPath,
          name: `${entry.name}/${child.name}`,
          kind: child.isDirectory() ? 'dir' : 'file',
          bytes: measured.bytes,
          files: measured.files,
        })
      }
      continue
    }

    const measured = measure(target)
    removable.push({
      path: target,
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file',
      bytes: measured.bytes,
      files: measured.files,
    })
  }

  removable.sort((a, b) => a.name.localeCompare(b.name))
  kept.sort()
  return {
    dir,
    removable,
    kept,
    removableBytes: removable.reduce((sum, entry) => sum + entry.bytes, 0),
    removableFiles: removable.reduce((sum, entry) => sum + entry.files, 0),
  }
}

/** 人类可读体积（保留 1 位小数；KB 以上才换单位） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 删除计划里的条目。**再次做路径闸**：只允许删 `dir` 的直接子项、或命名 profile 子目录的
 * 直接子项，且 basename 不在保留名单 —— `rmSync(recursive)` 的破坏面太大，不能只依赖调用方
 * 「没传错参数」。
 */
export function applyCleanPlan(plan: CleanPlan): void {
  const root = path.resolve(plan.dir)
  for (const entry of plan.removable) {
    const resolved = path.resolve(entry.path)
    const parent = path.dirname(resolved)
    const directChild = parent === root
    const profileChild =
      path.dirname(parent) === root && PROFILE_ARTIFACT_DIRS.includes(path.basename(parent))
    if ((!directChild && !profileChild) || KEPT_ARTIFACTS.includes(path.basename(resolved))) {
      throw new Error(
        `拒绝清理 ${resolved}：它不在 ${root}（或其 profile 子目录）的直接子项里，或命中了保留名单`,
      )
    }
    rmSync(resolved, { recursive: true, force: true })
  }
}

function printPlan(plan: CleanPlan, apply: boolean): void {
  console.log(`[e2e/clean] 目录：${plan.dir}`)
  if (plan.removable.length === 0) {
    console.log('[e2e/clean] 没有可清理的调试文件（只剩保留项或目录还没生成）')
  }
  for (const entry of plan.removable) {
    const suffix = entry.kind === 'dir' ? `（目录，${entry.files} 个文件）` : ''
    console.log(
      `[e2e/clean] ${apply ? '删除' : '将删'} ${entry.name}${suffix} ${formatBytes(entry.bytes)}`,
    )
  }
  if (plan.kept.length > 0) {
    console.log(`[e2e/clean] 保留：${plan.kept.join(' / ')}`)
  }
  const count = plan.removable.length
  const size = formatBytes(plan.removableBytes)
  if (apply) {
    console.log(`[e2e/clean] 已清理 ${count} 个条目（${plan.removableFiles} 个文件，${size}）`)
    return
  }
  console.log(
    `[e2e/clean] dry-run：将清理 ${count} 个条目（${plan.removableFiles} 个文件，${size}）。` +
      ' 确认后加 --force 真删（保留 baseline 三件套与 stack.json）',
  )
}

/** 入口：`node scripts/clean.ts [--force]` */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const unknown = argv.filter((arg) => arg !== '--force')
  if (unknown.length > 0) {
    console.error(`[e2e/clean] 不认识的参数：${unknown.join(' ')}（只接受 --force）`)
    return 2
  }
  const apply = argv.includes('--force')
  const plan = buildCleanPlan()
  if (apply) {
    applyCleanPlan(plan)
  }
  printPlan(plan, apply)
  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  process.exitCode = main()
}

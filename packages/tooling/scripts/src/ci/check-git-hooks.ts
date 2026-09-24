import fs from 'node:fs'
import path from 'node:path'
import { ViolationError } from '../lib/errors.ts'
import { out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/**
 * 断言 git 钩子**真的装上了**，而且是 lefthook 托管的那一份。
 *
 * 为什么需要它：钩子安装是**静默失败**的经典形态 ——
 *   ① lefthook 的 postinstall 就是 `lefthook install`，而 pnpm 12 默认不跑依赖的构建脚本；
 *      本仓 `strictDepBuilds: false` 只会**告警**，不阻断安装 ⇒ 钩子一个都没有，门禁全部消失；
 *   ② lefthook 找不到二进制时生成的 shim 默认只 echo 一行再 exit 0（同样静默）。
 * `lefthook.yml` 的 `assert_lefthook_installed: true` 挡的是 ② 的运行期；本脚本挡的是 ① 的安装期。
 *
 * 判据：三个钩子文件都存在，且都含 lefthook 的托管标记。
 * 退出码：0 = 全绿；1 = 有缺失/不是 lefthook 托管（这是**检出违规**，本地门禁确实在静默失效）。
 */
export interface HookCheckResult {
  ok: boolean
  lines: string[]
}

/** lefthook 写进 .git/hooks/* 的托管标记（各版本一致的一行） */
const LEFTHOOK_MARKER = 'LEFTHOOK'

const REQUIRED_HOOKS = ['pre-commit', 'commit-msg', 'pre-push'] as const

export function checkGitHooks(repoRoot: string = REPO_ROOT): HookCheckResult {
  const hooksDir = path.join(repoRoot, '.git', 'hooks')
  const lines: string[] = []

  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    lines.push('⚠  找不到 .git 目录（不在 git 工作树里？）—— 跳过钩子检查')
    return { ok: true, lines }
  }

  const missing: string[] = []
  const unmanaged: string[] = []

  for (const hook of REQUIRED_HOOKS) {
    const file = path.join(hooksDir, hook)
    if (!fs.existsSync(file)) {
      missing.push(hook)
      continue
    }
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    }
    catch {
      missing.push(hook)
      continue
    }
    // 内容里必须出现 lefthook 的标记；simple-git-hooks 写的钩子含 'SIMPLE_GIT_HOOKS' 而不含 LEFTHOOK
    if (!content.toUpperCase().includes(LEFTHOOK_MARKER))
      unmanaged.push(hook)
  }

  if (missing.length === 0 && unmanaged.length === 0) {
    lines.push(`✅ git 钩子已就位（lefthook 托管）：${REQUIRED_HOOKS.join(' / ')}`)
    return { ok: true, lines }
  }

  if (missing.length > 0)
    lines.push(`❌ 缺失的钩子文件：${missing.join(' / ')}（路径 ${hooksDir}）`)
  if (unmanaged.length > 0)
    lines.push(`❌ 不是 lefthook 托管的钩子（内容里没有 ${LEFTHOOK_MARKER} 标记）：${unmanaged.join(' / ')}`)
  lines.push('')
  lines.push('  为什么这会静默丢掉门禁：lefthook 的 postinstall 就是 `lefthook install`，而')
  lines.push('  pnpm 12 默认不跑依赖的构建脚本；本仓 strictDepBuilds: false 只会告警、不阻断安装。')
  lines.push('  修法：① 确认 pnpm-workspace.yaml 的 allowBuilds 里 `lefthook: true`；')
  lines.push('        ② 重跑 `pnpm install`；或直接 `pnpm exec lefthook install`。')
  return { ok: false, lines }
}

export function main(): void {
  const result = checkGitHooks()
  for (const line of result.lines)
    out(line)
  // 明细（哪些钩子没托管、为什么、怎么修）由 `checkGitHooks()` 组织好；**结论这一句**统一由 `runCli` 打
  if (!result.ok)
    throw new ViolationError('git 钩子不是 lefthook 托管的（明细见上）')
}

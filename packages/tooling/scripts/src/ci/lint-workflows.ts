import { spawnSync } from 'node:child_process'
import { SkippedError, ViolationError } from '../lib/errors.ts'
import { out } from '../lib/log.ts'

/**
 * 校验 .github/workflows/*.yml 与本地 composite action。
 *
 * 为什么需要这道闸：非法的 workflow 文件自己不会运行 —— GitHub 判定
 * "Invalid workflow file" 后直接启动即失败、0 个 job，表现为一个看起来只是
 * "跑失败了"的红叉。2026-08-13 到 09-21，本仓 CI 因 steps.if 里出现 secrets
 * 上下文而静默失效五周无人察觉。
 *
 * actionlint 未安装 ⇒ 抛 `SkippedError`（**退出码 3，不是 0**）：本机**未验证**，不等于通过，
 * 但也不阻塞本地 push（默认不判红）。CI 的 workflow-lint.yml 会强制安装并执行，那里才是权威闸门。
 * 上游两个消费方（prepush 的 workflows 段、发版的发版电池）都认 3 并把「跳过」单列 —— 别把这里
 * 改回 `return`：那会让「没验过」与「验过了」在机器眼里同形。
 * LINK https://github.com/rhysd/actionlint
 *
 * 本文件由根 `scripts/lint-workflows.ts` 收编而来（仓库级脚本的家现在是 @walnut/scripts）；
 * `pnpm lint:workflows` 指向本目录 bin。
 */
export function main(): void {
  const probe = spawnSync('actionlint', ['--version'], { encoding: 'utf8', shell: true })

  if (probe.error || probe.status !== 0) {
    throw new SkippedError(
      '未检测到 actionlint：workflow **未验证**（跳过不等于通过）。权威闸门是 CI 的 '
      + '.github/workflows/workflow-lint.yml；安装方式见 https://github.com/rhysd/actionlint#download',
    )
  }

  out(`actionlint: ${(probe.stdout || '').trim()}`)

  // 输出直接 `inherit` 给 actionlint（它自己往 stderr 写结构化诊断，中间隔一层只会丢信息）
  const result = spawnSync('actionlint', ['-color'], { stdio: 'inherit', shell: true })

  if (result.status !== 0)
    throw new ViolationError('actionlint 校验未通过（明细见上）')
}

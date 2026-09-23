import { spawnSync } from 'node:child_process'
import process from 'node:process'

/**
 * 校验 .github/workflows/*.yml 与本地 composite action。
 *
 * 为什么需要这道闸：非法的 workflow 文件自己不会运行 —— GitHub 判定
 * "Invalid workflow file" 后直接启动即失败、0 个 job，表现为一个看起来只是
 * "跑失败了"的红叉。2026-08-13 到 09-21，本仓 CI 因 steps.if 里出现 secrets
 * 上下文而静默失效五周无人察觉。
 *
 * actionlint 未安装时**跳过**（不阻塞本地 push）；CI 的 workflow-lint.yml
 * 会强制安装并执行，那里才是权威闸门。
 * LINK https://github.com/rhysd/actionlint
 */

const probe = spawnSync('actionlint', ['--version'], { encoding: 'utf8', shell: true })

if (probe.error || probe.status !== 0) {
  console.warn('⚠  未检测到 actionlint，跳过 workflow 校验（CI 中会强制执行）')
  console.warn('   安装：https://github.com/rhysd/actionlint#download')
  process.exit(0)
}

console.log(`actionlint: ${(probe.stdout || '').trim()}`)

const result = spawnSync('actionlint', ['-color'], { stdio: 'inherit', shell: true })

process.exit(result.status ?? 1)

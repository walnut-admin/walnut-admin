/**
 * 仓库根的解析：脚本里凡是「相对仓库根」的路径都经这里。
 *
 * 为什么需要：脚本按生命周期分层在 `scripts/src/<层>/` 下，用 `import.meta.dirname` 加固定层数
 * 的写法会随目录调整而滑向 `scripts/` 自身 —— 错位后**不报错**：`git ls-files` 在错的目录下
 * 查不到文档（扫描面变成空集、门禁静默变绿），读相对路径则直接 ENOENT。改为向上找锚点，
 * 脚本放在哪一层都不影响结果。
 * 失败口径：找不到锚点抛 `PreconditionError`（「跑错目录」属前置条件未满足），**不回退 cwd** ——
 * 回退会让「跑错目录」表现为「扫描面为空」的绿灯。
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { PreconditionError } from './errors.ts'

/** 仓库根锚点：两者都在仓库根；worktree 下 `.git` 是文件而非目录，故只判存在性 */
const ANCHORS = ['pnpm-workspace.yaml', '.git'] as const

/** 从 startDir 起向上找**同时**含两个锚点的目录（两者都在才认：只有 `.git` 的内层仓库不算本仓根） */
function findRepoRoot(startDir: string): string {
  let dir = resolve(startDir)
  for (;;) {
    if (ANCHORS.every(anchor => existsSync(join(dir, anchor))))
      return dir
    const parent = dirname(dir)
    if (parent === dir)
      throw new PreconditionError(`找不到仓库根：从 ${startDir} 向上未发现 ${ANCHORS.join(' + ')}`)
    dir = parent
  }
}

/**
 * 本文件所在仓库的根目录（模块加载时求值一次）。
 *
 * 相对 `import.meta.dirname` 而非调用方的 cwd：脚本被从任意目录调用（CI、pre-push、手工
 * `node scripts/src/<层>/<名>.ts`）都要拿到同一个根。经 `tsx/esm` 加载时本文件仍是 Node 亲自
 * 加载的 ESM 模块，`import.meta.dirname`（Node 20.11+）因此指向它所在的 `scripts/src/lib/`，
 * 与谁启动它、启动时 cwd 在哪都无关。
 */
export const REPO_ROOT = findRepoRoot(import.meta.dirname)

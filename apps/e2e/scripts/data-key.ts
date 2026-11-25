/**
 * **数据树哈希（dataKey）**：基线漂移判据的唯一真源。
 *
 * 为什么不再比整个 HEAD：2026-11-25 的调查里，任何提交（包括只改文档 / 前端）都会让本地基线
 * 失效，下次 run 退出码 2 —— 与数据无关的提交也被当成「测试数据可能变了」。反过来，未提交的
 * seed / 迁移改动又判不出来。dataKey 把判据收紧到**只对「决定测试库内容」的路径**：
 *
 * - 目录按 **git 树哈希**（`git rev-parse HEAD:<path>`）参与 —— 内容、文件名、子目录一起变；
 * - 组合方式是「按路径排序后逐行 `<path>\t<treeHash>` 再 sha256」：与 {@link DATA_PATHS} 的
 *   书写顺序无关，但**增删路径**或**任何一棵树变化**都会改变结果；
 * - 工作区**未提交**的改动由 {@link currentDataSnapshot} 的 `dirtyPaths` 单独判定（`git status
 *   --porcelain -- <paths>`）：脏 ⇒ 本轮拒绝 restore（退出码 2），提示 `--rebuild-baseline`。
 *   这比「只比 HEAD」更严：用旧数据跑新 schema 比多跑一次 prepare 危险得多。
 *
 * 判据是显式的：dataKey 只反映**已提交**的数据源；未提交改动永远走「脏 ⇒ 退出 2」那条路，
 * 不会出现「封板时脏、之后干净，于是把脏数据当 HEAD 数据」的静默组合。
 *
 * 维护：新增 / 重命名数据真源（seed 目录、迁移目录、prepare 逻辑、seed 工具）时改这里，
 * 并记得 `pnpm --filter @walnut/e2e test` 会重算 —— dataKey 变了，旧基线自然失效（预期行为）。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { REPO_ROOT } from './env.ts'
import { E2ePreconditionError } from './failure.ts'

/**
 * 参与 dataKey 的路径（仓库相对路径）。判据：**改动会改变「prepare 之后库里的数据」**。
 *
 * - `apps/server/db/seed`：seed 数据本体（JSON 行）；
 * - `apps/server/apps/api/migrations`：schema + 数据迁移；
 * - `apps/e2e/scripts/prepare-db.ts`：迁移 / seed 之后的提升 root、CAP 放宽；
 * - `tooling/scripts/src/db/{seed-pg,seed,seed-reshape,admin-credential,app-keys}.ts`：
 *   seed 的装载器与口令 / app_key 生成逻辑（改它同样改变库内容）。
 *
 * 刻意**不在**这里：文档 / 前端 / 后端源码（与测试库内容无关）、`runtime-reset.ts`
 * （restore 与 prepare 都重做的运行时状态，不进快照）。
 */
export const DATA_PATHS = [
  'apps/server/db/seed',
  'apps/server/apps/api/migrations',
  'apps/e2e/scripts/prepare-db.ts',
  'tooling/scripts/src/db/seed-pg.ts',
  'tooling/scripts/src/db/seed.ts',
  'tooling/scripts/src/db/seed-reshape.ts',
  'tooling/scripts/src/db/admin-credential.ts',
  'tooling/scripts/src/db/app-keys.ts',
] as const

export interface DataTreeEntry {
  /** 仓库相对路径（与 {@link DATA_PATHS} 的写法一致） */
  path: string
  /** `git rev-parse HEAD:<path>` 的输出（目录是树哈希，文件是 blob 哈希） */
  treeHash: string
}

export interface DataSnapshot {
  /** 当前 HEAD 的数据树哈希（64 位 hex） */
  dataKey: string
  /** 有未提交改动（含未跟踪文件）的数据路径名（porcelain 行里的路径） */
  dirtyPaths: string[]
}

/**
 * 组合树哈希（**纯函数**，单测直击）。
 *
 * 排序后拼接，保证「同一组路径与哈希」无论入参顺序如何都得到同一个 key；路径名参与哈希，
 * 所以重命名一个数据路径（即使内容不变）也会改变 dataKey。
 */
export function combineDataKey(entries: readonly DataTreeEntry[]): string {
  const lines = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(entry => `${entry.path}\t${entry.treeHash}`)
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex')
}

/**
 * 解析 `git status --porcelain` 的输出为路径列表（**纯函数**，单测直击）。
 *
 * porcelain v1 每行形如 `XY path`（重命名是 `R  old -> new`）；这里只取人读的路径部分，
 * 用途是「告诉用户哪条路径脏了」，不参与任何哈希。
 */
export function parseDirtyPaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map((line) => {
      // 前两位是状态码，第三位是分隔空格
      const body = line.length > 3 ? line.slice(3) : line
      const arrow = body.indexOf(' -> ')
      return (arrow >= 0 ? body.slice(arrow + 4) : body).trim()
    })
}

function gitOutput(args: readonly string[], repoRoot: string): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

/** 单条路径的 HEAD 树哈希；路径不在 HEAD 里（改名 / 浅克隆）按环境问题退出 2 */
function gitTreeHash(relPath: string, repoRoot: string): string {
  try {
    return gitOutput(['rev-parse', `HEAD:${relPath}`], repoRoot).trim()
  }
  catch (error) {
    throw new E2ePreconditionError(
      `读不到数据路径 \`${relPath}\` 的 HEAD 树哈希（git rev-parse HEAD:${relPath} 失败）：`
      + `${error instanceof Error ? error.message : String(error)}\n`
      + '  基线漂移判定依赖它。确认：(1) 在仓库内运行；(2) 浅克隆用 `git fetch --unshallow`（CI 是 fetch-depth: 0）；'
      + '(3) 数据路径改名后同步 apps/e2e/scripts/data-key.ts 的 DATA_PATHS。',
    )
  }
}

/**
 * 当前数据快照（HEAD 的 dataKey + 工作区脏路径）。读 git 失败按前置条件抛出（退出码 2）。
 */
export function currentDataSnapshot(repoRoot = REPO_ROOT): DataSnapshot {
  const entries = DATA_PATHS.map(path => ({ path, treeHash: gitTreeHash(path, repoRoot) }))
  let status = ''
  try {
    status = gitOutput(['status', '--porcelain', '--', ...DATA_PATHS], repoRoot)
  }
  catch (error) {
    throw new E2ePreconditionError(
      `读不到数据路径的工作区状态（git status --porcelain 失败）：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return { dataKey: combineDataKey(entries), dirtyPaths: parseDirtyPaths(status) }
}

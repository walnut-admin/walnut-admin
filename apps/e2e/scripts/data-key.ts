/**
 * **数据树哈希（dataKey）**：基线漂移判据的唯一真源。
 *
 * 为什么不再比整个 HEAD：2026-11-25 的调查里，任何提交（包括只改文档 / 前端）都会让本地基线
 * 失效，下次 run 退出码 2 —— 与数据无关的提交也被当成「测试数据可能变了」。反过来，未提交的
 * seed / 迁移改动又判不出来。dataKey 把判据收紧到**只对「决定测试库内容」的路径**：
 *
 * - 目录按 **git 树哈希**（`git rev-parse HEAD:<path>`）参与 —— 内容、文件名、子目录一起变；
 * - 组合方式是「按路径排序后逐行 `<path>\t<treeHash>` 再 sha256」：与数据路径清单的
 *   书写顺序无关，但**增删路径**或**任何一棵树变化**都会改变结果；
 * - 工作区**未提交**的改动由 {@link currentDataSnapshot} 的 `dirtyPaths` 单独判定（`git status
 *   --porcelain -- <paths>`）：脏 ⇒ 本轮拒绝 restore（退出码 2），提示 `--rebuild-baseline`。
 *   这比「只比 HEAD」更严：用旧数据跑新 schema 比多跑一次 prepare 危险得多。
 *
 * 判据是显式的：dataKey 只反映**已提交**的数据源；未提交改动永远走「脏 ⇒ 退出 2」那条路，
 * 不会出现「封板时脏、之后干净，于是把脏数据当 HEAD 数据」的静默组合。
 *
 * 维护：数据路径清单的唯一真源是 `scripts/e2e-data-paths.ts` 的 `E2E_DATA_PATHS`（含路径类型；
 * `scripts/affected-plan.ts` 消费同一份）。新增 / 重命名数据真源时改那里 —— dataKey 随之变化，
 * 旧基线自然失效（预期行为）。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { MANIFEST_VERSION } from './baseline-manifest.ts'
import { DATA_PATHS } from './e2e-data-paths.ts'
import { REPO_ROOT } from './env.ts'
import { E2ePreconditionError } from './failure.ts'

/**
 * 参与 dataKey 的路径（仓库相对路径）来自 {@link import('./e2e-data-paths.ts').E2E_DATA_PATHS}：
 * 判据是**改动会改变「prepare 之后库里的数据」**，清单与路径类型（目录 / 文件）的唯一真源在那里；
 * 本文件只负责把它们折算成树哈希。
 */

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
 * 基线缓存的键（**纯函数**，单测直击）：`v<清单格式版本>-<dataKey>`。
 *
 * 为什么带清单格式版本：CI 的基线三件套跨 run 缓存，键只认 dataKey 时，一次
 * `MANIFEST_VERSION` 升级（旧格式清单 restore 会拒收）会让缓存**每晚都命中同一份旧格式基线**、
 * 每晚红。把格式版本并进键里，升级即自然失效（miss ⇒ 全量 prepare + seal ⇒ 新格式入缓存）。
 * `dataKey` 仍然是「数据是否一致」的判据：格式版本相同而数据路径变了，键同样变。
 */
export function baselineCacheKey(dataKey: string, manifestVersion = MANIFEST_VERSION): string {
  return `v${manifestVersion}-${dataKey}`
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
      + '(3) 数据路径改名后同步 apps/e2e/scripts/e2e-data-paths.ts 的 E2E_DATA_PATHS。',
    )
  }
}

/**
 * 当前数据快照（HEAD 的 dataKey + 工作区脏路径）。读 git 失败按前置条件抛出（退出码 2）。
 */
export function currentDataSnapshot(repoRoot = REPO_ROOT): DataSnapshot {
  const entries = DATA_PATHS.map(dataPath => ({ path: dataPath, treeHash: gitTreeHash(dataPath, repoRoot) }))
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

/**
 * 入口：`node scripts/data-key.ts [--cache-key]`。
 *
 * - 默认：stdout **只打印** 64 位 dataKey —— CI 的 `actions/cache` 直接拿它当键的一部分，
 *   任何日志前缀都会让键不可复现；
 * - `--cache-key`：打印 `v<MANIFEST_VERSION>-<dataKey>`（基线缓存键的完整形态，见
 *   {@link baselineCacheKey}）；
 * - 数据路径有未提交改动时只往 **stderr** 警告，stdout 仍是纯 key、退出码不变：
 *   「算键」与「这份基线能不能用」是两件事，后者由 `baseline.ts` 的 `baselineUsable` 判。
 */
function main(): void {
  const argv = process.argv.slice(2)
  const unknown = argv.filter(arg => arg !== '--cache-key')
  if (unknown.length > 0) {
    throw new E2ePreconditionError(`不认识的参数：${unknown.join(' ')}（只接受 --cache-key）`)
  }

  const snapshot = currentDataSnapshot()
  if (snapshot.dirtyPaths.length > 0) {
    console.error(
      `[e2e/data-key] 警告：${snapshot.dirtyPaths.length} 条数据路径有未提交改动，`
      + `这份 dataKey 对应的基线会被 restore 拒收（先提交 / 还原）：\n  ${snapshot.dirtyPaths.join('\n  ')}`,
    )
  }
  console.log(argv.includes('--cache-key') ? baselineCacheKey(snapshot.dataKey) : snapshot.dataKey)
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  try {
    main()
  }
  catch (error) {
    console.error(`[e2e/data-key] 失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = error instanceof E2ePreconditionError ? 2 : 1
  }
}

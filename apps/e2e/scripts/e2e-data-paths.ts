/**
 * E2E 的**数据路径单一真源**：这组路径的改动会改变「prepare 之后的库内数据」。
 *
 * 两个消费方、同一组路径、不同的语义（都在消费端表达，不在本文件里分叉）：
 *
 * - `scripts/data-key.ts` —— **基线漂移判据**：对每条路径取 HEAD 树哈希、组合成 dataKey，
 *   并检查工作区脏状态。只关心「数据源是否与封板时一致」，不看改动类型；
 * - `scripts/affected-plan.ts` —— **改动范围映射**：改了任何一条 ⇒ 必须 `--rebuild-baseline`
 *   并跑全量（旧快照的数据不等于新源码的数据）。
 *
 * 为什么必须合一（P2-C 的教训）：两份清单各自维护时，新增一条数据真源（例如换一个 seed 工具）
 * 只在一边补，症状是**静默的** —— dataKey 不变（基线被当成有效）或 affected 只跑子集（漏测）。
 *
 * 维护：新增 / 重命名数据真源时只改 {@link E2E_DATA_PATHS}；两侧单测
 * （`data-key.test.ts` / `affected-plan.test.ts` / `e2e-data-paths.test.ts`）与
 * `pnpm --filter @walnut/e2e test` 会立刻反映出来。dataKey 变化 ⇒ 旧基线自然失效，这是预期行为。
 */

/** 路径类型：目录按「等于它或在其下」匹配，文件按逐字相等匹配 */
export type E2eDataPathKind = 'dir' | 'file'

export interface E2eDataPath {
  /** 仓库相对路径（POSIX 分隔符；`scripts/data-key.ts` 直接交给 `git rev-parse HEAD:<path>`） */
  path: string
  kind: E2eDataPathKind
}

/**
 * 参与 dataKey / affected 判定的全部路径。判据：**改动会改变 prepare 之后库里的数据**。
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
export const E2E_DATA_PATHS: readonly E2eDataPath[] = [
  { path: 'apps/server/db/seed', kind: 'dir' },
  { path: 'apps/server/apps/api/migrations', kind: 'dir' },
  { path: 'apps/e2e/scripts/prepare-db.ts', kind: 'file' },
  { path: 'tooling/scripts/src/db/seed-pg.ts', kind: 'file' },
  { path: 'tooling/scripts/src/db/seed.ts', kind: 'file' },
  { path: 'tooling/scripts/src/db/seed-reshape.ts', kind: 'file' },
  { path: 'tooling/scripts/src/db/admin-credential.ts', kind: 'file' },
  { path: 'tooling/scripts/src/db/app-keys.ts', kind: 'file' },
]

/** 纯路径列表：`git rev-parse HEAD:<path>` / `git status --porcelain -- <paths>` 直接消费 */
export const DATA_PATHS: readonly string[] = E2E_DATA_PATHS.map(entry => entry.path)

/** 目录 ↔ 文件按 `/` 边界区分（`seed` 不能命中 `seed-extra`；文件必须逐字相等） */
function matchesDataPath(candidate: string, entry: E2eDataPath): boolean {
  if (entry.kind === 'file') {
    return candidate === entry.path
  }
  return candidate === entry.path || candidate.startsWith(`${entry.path}/`)
}

/**
 * 一条**仓库相对、POSIX 分隔符**的路径是否属于数据面（纯函数，不归一化）。
 *
 * 调用方负责归一化（`scripts/affected-plan.ts` 已把 Windows 反斜杠与前导 `./` 处理成
 * POSIX 形态）；这里不重复那层逻辑，避免两处归一化规则漂移。
 */
export function isE2eDataPath(candidate: string): boolean {
  return E2E_DATA_PATHS.some(entry => matchesDataPath(candidate, entry))
}

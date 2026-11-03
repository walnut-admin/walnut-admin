import type { SpawnSyncReturns } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'
/**
 * 集成库种子层（`TEST_DATA` 未设为 `real` 时的默认数据源）。
 *
 * ## 为什么不直接 import tooling 的映射函数
 *
 * `@walnut/scripts` 的 `exports` 只暴露 `./lib/*`（`package.json` 的 exports 字段），
 * `src/db/seed-map.ts` 不是公开入口；从 `apps/server` 用相对路径深引会绕过包边界
 * （tooling 是独立包，app 反向依赖 tooling 属于架构倒挂）。**公开接口是 CLI**：
 * 这里 spawn `packages/tooling/scripts/bin/db-seed-pg.ts`，用的仍是同一条
 * `seed-map.ts` 映射（`$oid`→uuid v5、`$date`→timestamptz、junction 拆分、菜单按
 * 深度排序），不复制任何映射规则，也不会出现「测试种子与部署种子漂移」。
 *
 * ## 为什么 `app_setting` 不在默认清单里
 *
 * `app_setting` 是**部署配置**，不是参考数据。仓内 seed 的典型值会与既有 API 测试的
 * 「零配置契约」冲突，且这些契约是 spec 里写明的：
 * - `app.functional.role`（scope=global、globalValue=switchable）会把 P2-9 的
 *   零配置 COMBINE 翻成 SWITCH（permission-chain / data-scope 系列显式依赖默认值）；
 * - `app.global.capjs.config.ttl=3600` 是**秒**（P1 单位统一后；旧代码把同一配置同时当毫秒/秒
 *   读过，那时预热后 CAP 校验缓存只剩 ~4s）。现在缓存窗口 = `min(3600, 20min)` = 20 分钟，
 *   与零配置默认值同口径 —— 这条历史理由已失效，排除它的真正原因是下一条：`app_setting` 是
 *   **部署配置**不是参考数据；
 * - `app.auth.email.authEnable=1` 会让 `otp.api-spec` 的「缺省关闭」用例直接失去前提。
 *
 * 结论：默认只灌 7 个**参考数据**集合（菜单/角色/字典/语言/语言包/演示账号）。
 * `TEST_DATA=real` 走 dev 库全量 dump，配置随真实数据一起进（那时只有只读 suite 跑）。
 */
export const INTEGRATION_SEED_COLLECTIONS = [
  'sys_lang',
  'sys_locale',
  'sys_dict_type',
  'sys_dict_data',
  'sys_menu',
  'sys_role',
  'sys_user',
] as const

/** 从 cwd（apps/server）向上找 pnpm-workspace.yaml，拿到仓库根 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir)
  for (;;) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error(`[integration][seed] 从 ${startDir} 向上找不到 pnpm-workspace.yaml（不是仓库内运行？）`)
    }
    current = parent
  }
}

export interface SeedLayerOptions {
  repoRoot: string
  /** 后端 env 文件绝对路径（globalSetup 已经解析过 env-local/.env.development） */
  envFile: string
  /** 集成库名（工具 CLI 的 --pg-db） */
  database: string
}

export interface SeedLayerResult {
  collections: readonly string[]
  seedMs: number
  replayMs: number
  upserted: Record<string, number>
}

interface SeedPass {
  ms: number
  stdout: string
  stderr: string
  upserted: Record<string, number>
}

/** 解析 CLI 每行 `  <collection> 文档 N / upsert M`（幂等重放要与首次逐集合一致） */
function parseSeedCounts(output: string): Record<string, number> {
  const counts: Record<string, number> = {}
  const pattern = /^\s{2}(\w+)\s+文档\s+\d+\s+\/\s+upsert\s+(\d+)/gm
  for (const match of output.matchAll(pattern)) {
    counts[match[1]] = Number.parseInt(match[2], 10)
  }
  return counts
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- CLI 的 ANSI 颜色码在非 TTY 下通常不输出，但兜底
  return text.replace(/\u001B\[\d+(?:;\d+)*m/g, '')
}

function runSeedPass(options: SeedLayerOptions): SeedPass {
  const bin = path.join(options.repoRoot, 'packages/tooling/scripts/bin/db-seed-pg.ts')
  if (!fs.existsSync(bin)) {
    throw new Error(`[integration][seed] 找不到 seed CLI：${bin}`)
  }

  const args = [
    bin,
    '--skip-app-keys',
    '--pg-db',
    options.database,
    '--env-file',
    options.envFile,
    '--seed-dir',
    path.join(options.repoRoot, 'apps/server/db/seed'),
    '--only',
    INTEGRATION_SEED_COLLECTIONS.join(','),
  ]

  const startedAt = Date.now()
  const result: SpawnSyncReturns<string> = spawnSync(process.execPath, args, {
    cwd: options.repoRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  })
  const ms = Date.now() - startedAt
  const stdout = stripAnsi(result.stdout ?? '')
  const stderr = stripAnsi(result.stderr ?? '')

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      '[integration][seed] 种子 CLI 失败'
      + `（exit=${String(result.status)}${result.error === undefined ? '' : `, ${result.error.message}`}）\n`
      + `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    )
  }

  const upserted = parseSeedCounts(stdout)
  const missing = INTEGRATION_SEED_COLLECTIONS.filter(name => !(name in upserted))
  if (missing.length > 0) {
    throw new Error(
      `[integration][seed] CLI 输出里缺少集合的 upsert 统计：${missing.join(', ')}\n--- stdout ---\n${stdout}`,
    )
  }

  return { ms, stdout, stderr, upserted }
}

/**
 * 灌入种子层并做一轮幂等重放（第二次 upsert 计数必须与第一次逐集合相同）。
 *
 * 幂等验证放在 globalSetup 每次执行（而不是只做一次人工验证）：种子层是每轮集成库的
 * 数据底座，重放不收敛意味着某天 seed 文件/映射改动引入了非幂等写，必须在门禁里红。
 */
export async function seedIntegrationDatabase(options: SeedLayerOptions): Promise<SeedLayerResult> {
  console.log(`[integration][seed] 灌入 ${INTEGRATION_SEED_COLLECTIONS.length} 个参考数据集合（app_setting 按设计排除）`)

  const first = runSeedPass(options)
  console.log(`[integration][seed] 首轮完成 ${first.ms}ms：${Object.entries(first.upserted).map(([k, v]) => `${k}=${v}`).join(' ')}`)

  const replay = runSeedPass(options)
  const mismatched = INTEGRATION_SEED_COLLECTIONS.filter(name => first.upserted[name] !== replay.upserted[name])
  if (mismatched.length > 0) {
    throw new Error(
      `[integration][seed] 幂等重放计数不一致：${mismatched.map(name => `${name}: ${first.upserted[name]} -> ${replay.upserted[name]}`).join(', ')}`,
    )
  }
  console.log(`[integration][seed] 幂等重放通过 ${replay.ms}ms（逐集合 upsert 计数一致）`)

  return {
    collections: INTEGRATION_SEED_COLLECTIONS,
    seedMs: first.ms,
    replayMs: replay.ms,
    upserted: first.upserted,
  }
}

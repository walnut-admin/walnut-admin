/**
 * PG 连接目标的解析 —— `db:etl` / `db:seed:pg` / `db:export:pg` / `db:verify-etl` 四个 PG 通道
 * 共用（与 `data-source.cli.ts` / `fix-setting-default-role.ts` 同一组 `DATABASE_PG_*` 变量、
 * 同一解析模式）。PG 连接参数**只**从后端那份 env 文件取，不自己发明默认值（无 env 直接抛，
 * 与 Mongo 侧 `resolveConnection` 同口径）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { PreconditionError } from '../lib/errors.ts'
import { parseEnvFile, resolveEnvFile } from './seed.ts'

export interface PgTarget {
  host: string
  port: number
  user: string
  password: string
  database: string
}

/**
 * 解析 PG 连接目标。`envFileOverride` / `pgDbNameOverride` 对应 `--env-file` / `--pg-db`；
 * 相对路径按仓库根解（`resolveEnvFile` 的口径）。
 */
export function resolvePgTarget(repoRoot: string, envFileOverride?: string, pgDbNameOverride?: string): { target: PgTarget, envFile: string } {
  const envFile = resolveEnvFile(repoRoot, envFileOverride)
  if (!existsSync(envFile)) {
    throw new PreconditionError(`找不到 env 文件 ${envFile} —— 先跑 \`pnpm setup-env\`，或用 --env-file 指定`)
  }
  const env = parseEnvFile(readFileSync(envFile, 'utf8'))

  const host = env.DATABASE_PG_HOST
  const port = Number.parseInt(env.DATABASE_PG_PORT)
  const user = env.DATABASE_PG_USER
  const password = env.DATABASE_PG_PASS
  if (!host || Number.isNaN(port) || !user) {
    throw new PreconditionError(`env 文件缺 DATABASE_PG_* 变量（${envFile}）—— 与 data-source.cli 同源的一组`)
  }

  const database = pgDbNameOverride ?? env.DATABASE_PG_NAME
  if (!database) {
    throw new PreconditionError('解析不出 PG 库名 —— 用 --pg-db 明确指定')
  }

  return { target: { host, port, user, password, database }, envFile }
}

/**
 * seed 目录 / env 文件解析的共享纯助手 —— `db:seed:pg`、`db:export:pg`、`check-seed`
 * 与 `pg-conn.ts` 共用（Phase 5a 起 Mongo 版 `db:seed` / `db:export` 通道已退役，
 * PG 通道 `seed-pg.ts` / `export-pg.ts` 接管）。
 */
import { readdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'

/** 仓库里 seed 数据的默认位置（相对仓库根） */
export const SEED_DIR = 'apps/server/db/seed'

/** seed 目录里的集合名（文件名去掉 `.json`） */
export function listSeedCollections(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort()
}

/**
 * 路径解析：相对路径按**仓库根**解，绝对路径原样用。
 *
 * 为什么要有它：`--out`/`--with-areas` 这类参数用户既可能给相对路径（`apps/server/db/seed`），
 * 也可能给绝对路径（临时目录、下载下来的 Release 资产）。直接 `join(repoRoot, p)` 会把绝对路径
 * 拼成 `D:\repo\C:\Users\…` 这种怪物 —— 实测踩到过。
 *
 * `isAbs` 可注入：绝对路径的判定是**平台语义**（`C:/tmp` 在 Linux 上不是绝对路径，`/tmp` 在
 * Windows 上也不是），用例要能确定性地两种都测 —— 否则同一个断言在 Windows 绿、在 CI 的 Linux 红
 * （实测就是这么红的）。
 */
export function resolvePath(repoRoot: string, p: string, isAbs: (path: string) => boolean = isAbsolute): string {
  return isAbs(p) ? p : join(repoRoot, p)
}

/** 极简 `KEY=VALUE` 解析（env 文件已是明文；不引 dotenv，避免多一个依赖面） */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const lineText = raw.trim()
    if (lineText === '' || lineText.startsWith('#'))
      continue
    const eq = lineText.indexOf('=')
    if (eq <= 0)
      continue
    const key = lineText.slice(0, eq).trim()
    let value = lineText.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))
      value = value.slice(1, -1)
    env[key] = value
  }
  return env
}

/** 取后端那份 env 文件（`NODE_ENV ?? development`，与后端同一口径） */
export function resolveEnvFile(repoRoot: string, envFileOverride?: string): string {
  if (envFileOverride !== undefined)
    return resolvePath(repoRoot, envFileOverride)
  const env = process.env.NODE_ENV ?? 'development'
  return join(repoRoot, 'apps/server/env-local', `.env.${env}`)
}

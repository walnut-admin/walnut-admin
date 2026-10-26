/**
 * Mongo 连接目标的解析 —— `db:etl` / `db:verify-etl` 两个 ETL 侧通道共用。
 *
 * ## 为什么不复用 `seed.ts` 的 `resolveConnection`
 *
 * 那份实现在「没给 `--db`」时用 WHATWG `new URL(uri)` 从 URI 路径段抠库名 —— 而本仓的
 * 副本集连接串是**多主机逗号形态**（`host1:27017,host2:27027,host3:27037`），WHATWG URL
 * 解析不了这个 authority（实测 `TypeError: Invalid URL`）。seed 通道全靠显式传 `--db` 才绕开。
 * ETL 侧直接以 env 的 `DATABASE_NAME` 为缺省库名（与后端同一组变量、同一优先级：
 * `--db` > `DATABASE_NAME`），不碰 `new URL`。旧脚本本批保留不动（Phase 5 清理）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { PreconditionError } from '../lib/errors.ts'
import { buildMongoUri, parseEnvFile, resolveEnvFile } from './seed.ts'

export interface MongoTarget {
  uri: string
  dbName: string
  envFile: string
}

export function resolveMongoTarget(repoRoot: string, opts: { uri?: string, dbName?: string, envFile?: string }): MongoTarget {
  const envFile = resolveEnvFile(repoRoot, opts.envFile)
  let uri = opts.uri
  if (uri === undefined) {
    if (!existsSync(envFile)) {
      throw new PreconditionError(`找不到 env 文件 ${envFile} —— 先跑 \`pnpm setup-env\`，或用 --env-file / --uri 指定`)
    }
    uri = buildMongoUri(parseEnvFile(readFileSync(envFile, 'utf8')), opts.dbName)
  }
  const dbName = opts.dbName ?? parseEnvFile(existsSync(envFile) ? readFileSync(envFile, 'utf8') : '').DATABASE_NAME
  if (dbName === undefined || dbName === '') {
    throw new PreconditionError('解析不出 Mongo 库名 —— 用 --db 明确指定（env 里也没有 DATABASE_NAME）')
  }
  return { uri, dbName, envFile }
}

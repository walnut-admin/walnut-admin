/**
 * `pnpm db:seed` —— 把 `apps/server/db/seed/` 里的初始化数据播种进库。
 *
 * ## 为什么是 Node 脚本而不是 `mongoimport`
 *
 * 这台机器（以及 CI）都**没有 mongoimport / mongosh**，也没有 Docker ⇒ 走 `mongodb` 驱动是唯一
 * 不引入外部工具的路子。顺带两个好处：Extended JSON 由我们自己解析（精度可控）、
 * `app_key` 能现生成（见 `app-keys.ts`）。
 *
 * ## 幂等
 *
 * 每个集合按 `_id` 做 `replaceOne + upsert`（`app_key` 没有固定 `_id`，按 `key` 判存在）——
 * 重复跑安全，且**不删**库里多出来的文档（seed 不是"清库"，别把开发数据一起扫了）。
 *
 * ## 连接口径与后端的**同一个**
 *
 * 后端从 `apps/server/env-local/.env.${NODE_ENV ?? 'development'}` 读 `DATABASE_*`（副本集），
 * 这里照抄那条口径（`--env-file` / `--uri` 可覆盖）。不自己发明一套连接参数 —— 播种必须落在
 * 后端真正读的那个库上，否则"播了但登录不了"会浪费一整轮排查。
 */
import type { Db, Document, Filter } from 'mongodb'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { MongoClient } from 'mongodb'
import { PreconditionError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { generateAppKeys } from './app-keys.ts'
import { parseCollectionFile } from './ejson.ts'

/** 仓库里 seed 数据的默认位置（相对仓库根） */
export const SEED_DIR = 'apps/server/db/seed'

/** seed 目录里的集合名（文件名去掉 `.json`） */
export function listSeedCollections(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort()
}

export interface SeedOptions {
  seedDir: string
  envFile: string
  uri?: string
  dbName?: string
  only?: string[]
  dryRun: boolean
  withAreas?: string
  /** 只播种数据、不碰 app_key（排障用） */
  skipAppKeys: boolean
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

/** 由后端那组 `DATABASE_*` 变量拼连接串（副本集；口令做 URL 编码） */
export function buildMongoUri(env: Record<string, string>, dbNameOverride?: string): string {
  const hosts = [env.DATABASE_PRIMARY, env.DATABASE_SECONDARY, env.DATABASE_ARBITER]
    .filter((h): h is string => typeof h === 'string' && h !== '')
  if (hosts.length === 0)
    throw new PreconditionError('env 里没有 DATABASE_PRIMARY —— 先跑 `pnpm setup-env` 解出 env-local/')

  const dbName = dbNameOverride ?? env.DATABASE_NAME ?? 'walnut-admin-nestjs'
  const auth = env.DATABASE_USER !== undefined && env.DATABASE_USER !== ''
    ? `${encodeURIComponent(env.DATABASE_USER)}:${encodeURIComponent(env.DATABASE_PASS ?? '')}@`
    : ''
  const params = new URLSearchParams()
  if (env.DATABASE_REPLICASET !== undefined && env.DATABASE_REPLICASET !== '')
    params.set('replicaSet', env.DATABASE_REPLICASET)
  if (env.DATABASE_SOURCE !== undefined && env.DATABASE_SOURCE !== '')
    params.set('authSource', env.DATABASE_SOURCE)
  const query = params.size > 0 ? `?${params.toString()}` : ''
  return `mongodb://${auth}${hosts.join(',')}/${dbName}${query}`
}

/** 取后端那份 env 文件（`NODE_ENV ?? development`，与后端同一口径） */
export function resolveEnvFile(repoRoot: string, envFileOverride?: string): string {
  if (envFileOverride !== undefined)
    return envFileOverride
  const env = process.env.NODE_ENV ?? 'development'
  return join(repoRoot, 'apps/server/env-local', `.env.${env}`)
}

/** 解析 argv（`--flag` / `--key value`；未知参数直接报错，避免"拼错了却静默跑默认值"） */
export function parseArgs(argv: readonly string[]): SeedOptions {
  const opts: SeedOptions = { seedDir: SEED_DIR, envFile: '', dryRun: false, skipAppKeys: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[++i]
      if (value === undefined)
        throw new PreconditionError(`${arg} 后面缺参数值`)
      return value
    }
    switch (arg) {
      case '--dry-run':
        opts.dryRun = true
        break
      case '--skip-app-keys':
        opts.skipAppKeys = true
        break
      case '--only':
        opts.only = next().split(',').map(s => s.trim()).filter(Boolean)
        break
      case '--uri':
        opts.uri = next()
        break
      case '--db':
        opts.dbName = next()
        break
      case '--env-file':
        opts.envFile = next()
        break
      case '--seed-dir':
        opts.seedDir = next()
        break
      case '--with-areas':
        opts.withAreas = next()
        break
      default:
        throw new PreconditionError(`未知参数 ${arg}（支持 --dry-run / --only / --uri / --db / --env-file / --seed-dir / --with-areas / --skip-app-keys）`)
    }
  }
  return opts
}

interface WriteResult {
  collection: string
  total: number
  inserted: number
  replaced: number
}

/** 一个集合的幂等写入：按 `_id`（缺 `_id` 时按 `key`）replace + upsert */
async function seedCollection(db: Db, name: string, docs: readonly Record<string, unknown>[], dryRun: boolean): Promise<WriteResult> {
  if (dryRun)
    return { collection: name, total: docs.length, inserted: 0, replaced: 0 }

  const result = await db.collection(name).bulkWrite(
    docs.map(doc => ({
      replaceOne: {
        // 没有 `_id` 的文档（现生成的 app_key）按 `key` 判存在 —— 否则每次播种都会多塞一份
        filter: (doc._id === undefined ? { key: doc.key } : { _id: doc._id }) as Filter<Document>,
        replacement: doc,
        upsert: true,
      },
    })),
    { ordered: false },
  )
  return {
    collection: name,
    total: docs.length,
    inserted: result.upsertedCount,
    replaced: result.matchedCount,
  }
}

/** `app_key`：库里没有 ACTIVE 的同类型密钥时才生成（重复跑不会多塞密钥） */
async function seedAppKeys(db: Db, dryRun: boolean): Promise<WriteResult> {
  const collection = db.collection('app_key')
  const wanted = generateAppKeys()
  const missing: typeof wanted = []
  for (const doc of wanted) {
    const exist = await collection.countDocuments({ type: doc.type, status: 'ACTIVE' })
    if (exist === 0)
      missing.push(doc)
  }
  if (dryRun || missing.length === 0)
    return { collection: 'app_key', total: wanted.length, inserted: dryRun ? missing.length : 0, replaced: 0 }

  await collection.insertMany(missing)
  return { collection: 'app_key', total: wanted.length, inserted: missing.length, replaced: 0 }
}

/** 命令行主体：读数据、连库、写、打汇总 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseArgs(process.argv.slice(2))
  const seedDir = join(repoRoot, opts.seedDir)
  if (!existsSync(seedDir))
    throw new PreconditionError(`找不到 seed 目录：${seedDir}`)

  const envFile = resolveEnvFile(repoRoot, opts.envFile === '' ? undefined : opts.envFile)
  let uri = opts.uri
  if (uri === undefined) {
    if (!existsSync(envFile))
      throw new PreconditionError(`找不到 env 文件 ${envFile} —— 先跑 \`pnpm setup-env\`，或用 --env-file / --uri 指定`)
    uri = buildMongoUri(parseEnvFile(readFileSync(envFile, 'utf8')), opts.dbName)
  }
  const dbName = opts.dbName ?? new URL(uri).pathname.replace(/^\//, '')

  const collections = listSeedCollections(seedDir).filter(c => opts.only === undefined || opts.only.includes(c))
  if (collections.length === 0)
    throw new PreconditionError(`seed 目录里没有可播种的集合（${seedDir}）`)

  out(`seed 目录：${opts.seedDir}（${collections.length} 个集合）`)
  out(`目标库：${dbName}${opts.dryRun ? '（dry-run，不写入）' : ''}`)

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  await client.connect()
  try {
    const db = client.db(dbName)
    const results: WriteResult[] = []
    for (const name of collections) {
      const docs = parseCollectionFile(readFileSync(join(seedDir, `${name}.json`), 'utf8'))
      results.push(await seedCollection(db, name, docs, opts.dryRun))
    }
    if (!opts.skipAppKeys)
      results.push(await seedAppKeys(db, opts.dryRun))

    for (const r of results) {
      const detail = opts.dryRun ? `待写入 ${r.total}` : `新增 ${r.inserted} / 覆盖 ${r.replaced}`
      out(`  ${r.collection.padEnd(16)} ${detail}`)
    }
    line('ok', `${opts.dryRun ? 'dry-run 完成（未写入任何文档）' : `播种完成：${results.length} 个集合`}`)
  }
  finally {
    await client.close()
  }
}

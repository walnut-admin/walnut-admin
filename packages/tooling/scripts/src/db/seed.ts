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
import { isAbsolute, join } from 'node:path'
import process from 'node:process'
import { gunzipSync } from 'node:zlib'
import { MongoClient } from 'mongodb'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { err, line, out } from '../lib/log.ts'
import { buildPasswordIdentity, verifyPasswordIdentity } from './admin-credential.ts'
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
  /** 只插不改：已存在的文档一个字都不动（**生产注入用**，见 `buildSeedOps`） */
  ifMissing: boolean
  /** 导出侧的落盘目录（`db:export --out`；播种命令不认这个参数） */
  outDir: string
  /** 导出侧的行政区划另存路径（`db:export --areas`） */
  areas?: string
  /** 导出时脱敏（`db:export --anonymize`；给「线上 → 开发」这条通道用） */
  anonymize: boolean
  /** 给哪个账号建口令凭证（`db:seed --admin <userName>`） */
  admin?: string
  /** 该账号的口令（与 `--admin` 配对；也可用环境变量 SEED_ADMIN_PASSWORD） */
  password?: string
}

export type CommandMode = 'seed' | 'export'

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

/** 取后端那份 env 文件（`NODE_ENV ?? development`，与后端同一口径） */
export function resolveEnvFile(repoRoot: string, envFileOverride?: string): string {
  if (envFileOverride !== undefined)
    return resolvePath(repoRoot, envFileOverride)
  const env = process.env.NODE_ENV ?? 'development'
  return join(repoRoot, 'apps/server/env-local', `.env.${env}`)
}

/**
 * 解析 argv（`--flag` / `--key value`；未知参数直接报错，避免"拼错了却静默跑默认值"）。
 *
 * `mode` 用来**把两个方向各自的参数挡在门外**：`db:seed` 不认 `--out`/`--areas`，
 * `db:export` 不认 `--dry-run`/`--with-areas`。静默忽略的代价是"以为导出了、其实没导"。
 */
export function parseArgs(argv: readonly string[], mode: CommandMode = 'seed'): SeedOptions {
  const opts: SeedOptions = { seedDir: SEED_DIR, envFile: '', dryRun: false, skipAppKeys: false, ifMissing: false, anonymize: false, outDir: SEED_DIR }
  const allowed: Record<CommandMode, string> = {
    seed: '--dry-run / --only / --uri / --db / --env-file / --seed-dir / --with-areas / --skip-app-keys / --if-missing / --admin / --password',
    export: '--only / --uri / --db / --env-file / --seed-dir / --out / --areas / --anonymize',
  }
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
        if (mode !== 'seed')
          throw new PreconditionError(`db:export 不支持 ${arg}（支持 ${allowed.export}）`)
        opts.dryRun = true
        break
      case '--if-missing':
        if (mode !== 'seed')
          throw new PreconditionError(`db:export 不支持 ${arg}`)
        opts.ifMissing = true
        break
      case '--skip-app-keys':
        if (mode !== 'seed')
          throw new PreconditionError(`db:export 不支持 ${arg}（支持 ${allowed.export}）`)
        opts.skipAppKeys = true
        break
      case '--with-areas':
        if (mode !== 'seed')
          throw new PreconditionError(`db:export 不支持 ${arg}（行政区划另存请用 --areas）`)
        opts.withAreas = next()
        break
      case '--out':
        if (mode !== 'export')
          throw new PreconditionError(`db:seed 不支持 ${arg}（支持 ${allowed.seed}）`)
        opts.outDir = next()
        break
      case '--admin':
        if (mode !== 'seed')
          throw new PreconditionError(`db:export 不支持 ${arg}`)
        opts.admin = next()
        break
      case '--password':
        if (mode !== 'seed')
          throw new PreconditionError(`db:export 不支持 ${arg}`)
        opts.password = next()
        break
      case '--anonymize':
        if (mode !== 'export')
          throw new PreconditionError(`db:seed 不支持 ${arg}（播种不做脱敏）`)
        opts.anonymize = true
        break
      case '--areas':
        if (mode !== 'export')
          throw new PreconditionError(`db:seed 不支持 ${arg}（导入行政区划请用 --with-areas）`)
        opts.areas = next()
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
      default:
        throw new PreconditionError(`未知参数 ${arg}（支持 ${allowed[mode]}）`)
    }
  }
  return opts
}

/**
 * 连接口径（两个方向共用）：`--uri` 优先，否则从后端那份 env 文件拼。
 * 库名取 `--db` → URI 里的路径 → env 的 `DATABASE_NAME`。
 */
export function resolveConnection(repoRoot: string, opts: Pick<SeedOptions, 'uri' | 'dbName' | 'envFile'>): { uri: string, dbName: string, envFile: string } {
  const envFile = resolveEnvFile(repoRoot, opts.envFile === '' ? undefined : opts.envFile)
  let uri = opts.uri
  if (uri === undefined) {
    if (!existsSync(envFile)) {
      throw new PreconditionError(`找不到 env 文件 ${envFile} —— 先跑 \`pnpm setup-env\`，或用 --env-file / --uri 指定`)
    }
    uri = buildMongoUri(parseEnvFile(readFileSync(envFile, 'utf8')), opts.dbName)
  }
  const dbName = opts.dbName ?? new URL(uri).pathname.replace(/^\//, '')
  if (dbName === '')
    throw new PreconditionError('解析不出库名 —— 用 --db 明确指定')
  return { uri, dbName, envFile }
}

interface WriteResult {
  collection: string
  total: number
  inserted: number
  replaced: number
}

/**
 * 构造一个集合的写入计划 —— **纯函数**，两种语义刻意分开：
 *
 * - 默认（覆盖）：`replaceOne + upsert` —— **整文档替换**。开发环境要的就是这个：仓是唯一真源。
 * - `ifMissing`（只插不改）：`updateOne + $setOnInsert + upsert` —— 不存在才插入，存在就**一个字不动**。
 *
 * 为什么生产注入必须用后者：运维会在后台改菜单名、调应用设置，而默认语义会**把这些改动覆盖回去**
 * （`replaceOne` 是把整文档换掉，不是打补丁）。生产要的是"把缺的补上"，不是"把库对齐到仓"。
 *
 * `_id` 缺失的文档（现生成的 app_key）按 `key` 认身份 —— 否则每次跑都会多插一份。
 */
export function buildSeedOps(
  docs: readonly Record<string, unknown>[],
  ifMissing: boolean,
): { filter: Filter<Document>, replacement?: Record<string, unknown>, update?: Document }[] {
  return docs.map((doc) => {
    const filter = (doc._id === undefined ? { key: doc.key } : { _id: doc._id }) as Filter<Document>
    return ifMissing ? { filter, update: { $setOnInsert: doc } } : { filter, replacement: doc }
  })
}

/** 一个集合的幂等写入：按 `_id`（缺 `_id` 时按 `key`）认身份 */
async function seedCollection(
  db: Db,
  name: string,
  docs: readonly Record<string, unknown>[],
  dryRun: boolean,
  ifMissing: boolean,
): Promise<WriteResult> {
  if (dryRun)
    return { collection: name, total: docs.length, inserted: 0, replaced: 0 }

  const result = await db.collection(name).bulkWrite(
    buildSeedOps(docs, ifMissing).map(op => (op.replacement !== undefined
      ? { replaceOne: { filter: op.filter, replacement: op.replacement, upsert: true } }
      // `$setOnInsert` + upsert：不存在才写，存在则完全不动（`matchedCount` 就是"已存在、被跳过"的数量）
      : { updateOne: { filter: op.filter, update: op.update as Document, upsert: true } })),
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

/**
 * 行政区划：**单独一个文件**（89MB，随 Release 发资产，不进仓）。
 *
 * 分块 upsert：66 万条一次性 bulkWrite 会把内存和单条命令的 BSON 上限一起顶穿。
 * 支持 `.json` 与 `.json.gz`（Release 资产是压缩过的，省得下游再解一遍）。
 */
export async function seedAreas(db: Db, file: string, dryRun: boolean, chunkSize = 5000): Promise<WriteResult> {
  const raw = file.endsWith('.gz') ? gunzipSync(readFileSync(file)) : readFileSync(file)
  const docs = parseCollectionFile(raw.toString('utf8'))

  if (dryRun)
    return { collection: 'shared_area', total: docs.length, inserted: 0, replaced: 0 }

  const collection = db.collection('shared_area')
  let inserted = 0
  let matched = 0
  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize)
    const result = await collection.bulkWrite(
      chunk.map(doc => ({ replaceOne: { filter: { _id: doc._id } as Filter<Document>, replacement: doc, upsert: true } })),
      { ordered: false },
    )
    inserted += result.upsertedCount
    matched += result.matchedCount
    if ((i / chunkSize) % 20 === 0)
      out(`  shared_area 进度 ${Math.min(i + chunkSize, docs.length)} / ${docs.length}`)
  }
  return { collection: 'shared_area', total: docs.length, inserted, replaced: matched }
}

/**
 * 给某个已存在的账号建口令凭证（`db:seed --admin`）。
 *
 * 凭证**不能随仓库发布**（OPAQUE 的注册记录绑定本环境的 `AUTH_OPAQUE_SECRET`，见
 * `admin-credential.ts` 顶部），所以这一步必须在目标环境里现跑；跑完立刻用同一套协议验证一遍登录。
 */
export async function seedAdminCredential(db: Db, admin: string, password: string, serverSetup: string): Promise<void> {
  const user = await db.collection('sys_user').findOne({ userName: admin })
  if (user === null)
    throw new PreconditionError(`库里没有账号 ${admin} —— 先跑 \`pnpm db:seed\`（它会播演示账号档案），或换一个已存在的 userName`)

  let identity
  try {
    identity = buildPasswordIdentity(String(user._id), admin, password, serverSetup)
  }
  catch (error) {
    // 实测：secret 不是一份有效的 OPAQUE serverSetup 时，**注册那一步**就在 WASM 里炸了，
    // 报出来是一串 wasm 栈 —— 对使用者毫无信息量。这里翻成一句能照做的话（并归为"前置条件"）。
    throw new PreconditionError(
      `拿本环境的 AUTH_OPAQUE_SECRET 跑 OPAQUE 注册失败（${error instanceof Error ? error.message : String(error)}）`
      + '\n  · 它必须是后端实际使用的那一份（--env-file 指向的 env 文件里的 AUTH_OPAQUE_SECRET）',
    )
  }
  const collection = db.collection('sys_user_identity')
  const result = await collection.bulkWrite(
    [{
      replaceOne: {
        filter: { userId: identity.userId, type: identity.type, purpose: identity.purpose },
        replacement: identity,
        upsert: true,
      },
    }],
    { ordered: false },
  )
  out(`  sys_user_identity  ${result.upsertedCount > 0 ? '新增 1' : '覆盖 1'}（账号 ${admin} 的口令凭证）`)

  const proof = verifyPasswordIdentity(admin, password, identity.value, serverSetup)
  if (!proof.ok) {
    err(`凭证写进去了，但登录握手没通过：${proof.reason}`)
    err('这通常说明 AUTH_OPAQUE_SECRET 与后端实际使用的不一致 —— 检查 --env-file 指向的那份 env。')
    throw new ViolationError('口令凭证在本环境验证失败（明细见上）')
  }
  line('ok', `口令已验证：${admin} 用该口令能完成完整 OPAQUE 登录握手（会话密钥 ${proof.sessionKeyLength} 字节）`)
}

/** 命令行主体：读数据、连库、写、打汇总 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseArgs(process.argv.slice(2), 'seed')
  const seedDir = resolvePath(repoRoot, opts.seedDir)
  if (!existsSync(seedDir))
    throw new PreconditionError(`找不到 seed 目录：${seedDir}`)

  const { uri, dbName, envFile } = resolveConnection(repoRoot, opts)

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
      results.push(await seedCollection(db, name, docs, opts.dryRun, opts.ifMissing))
    }
    if (!opts.skipAppKeys)
      results.push(await seedAppKeys(db, opts.dryRun))

    for (const r of results) {
      const detail = opts.dryRun ? `待写入 ${r.total}` : `新增 ${r.inserted} / 覆盖 ${r.replaced}`
      out(`  ${r.collection.padEnd(16)} ${detail}`)
    }

    if (opts.withAreas !== undefined) {
      const file = resolvePath(repoRoot, opts.withAreas)
      if (!existsSync(file))
        throw new PreconditionError(`找不到行政区划文件：${file}`)
      const r = await seedAreas(db, file, opts.dryRun)
      const detail = opts.dryRun ? `待写入 ${r.total}` : `新增 ${r.inserted} / 覆盖 ${r.replaced}`
      out(`  ${r.collection.padEnd(16)} ${detail}`)
      results.push(r)
    }

    if (opts.admin !== undefined) {
      const env = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {}
      const serverSetup = env.AUTH_OPAQUE_SECRET
      if (serverSetup === undefined || serverSetup === '')
        throw new PreconditionError(`env 里没有 AUTH_OPAQUE_SECRET（${envFile}）—— 口令凭证必须用**本环境**的 OPAQUE 密钥生成`)
      const password = opts.password ?? process.env.SEED_ADMIN_PASSWORD
      if (password === undefined || password === '')
        throw new PreconditionError('--admin 需要配 --password（或环境变量 SEED_ADMIN_PASSWORD）')
      if (opts.dryRun)
        out(`  sys_user_identity  待写入（账号 ${opts.admin} 的口令凭证；dry-run 不生成也不验证）`)
      else
        await seedAdminCredential(db, opts.admin, password, serverSetup)
    }

    line('ok', `${opts.dryRun ? 'dry-run 完成（未写入任何文档）' : `播种完成：${results.length} 个集合`}`)
  }
  finally {
    await client.close()
  }
}

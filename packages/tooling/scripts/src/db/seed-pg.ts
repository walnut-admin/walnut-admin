import type { EtlMapContext } from './etl-map.ts'
/**
 * `db:seed:pg` —— 把 `apps/server/db/seed/` 的初始化数据播种进 **PostgreSQL**（PG 化的 seed 通道，
 * CI / 部署接线用；Phase 5 起 deploy.yml 调它）。
 *
 * ## 与旧 `db:seed`（Mongo 版，Phase 5a 已退役）的关系
 *
 * 源真源不变：还是仓里那 8 个 Extended JSON 文件（`$oid` / `$date` 保持原样）。本脚本走
 * `etl-map.ts` 同一条映射（`$oid` → uuid v5、`$date` → timestamptz、meta 拍平、junction 拆分），
 * 保证「seed 重建出的 PG」与「ETL 搬出来的 PG」id 逐行一致（phase2 §3.2 定稿的初衷）。
 *
 * ## 幂等
 *
 * 按 id upsert：已存在的行整行刷新为 seed 值（`ON CONFLICT (id) DO UPDATE`）——仓是 seed 集合的
 * 唯一真源，重放必须收敛到 seed 形态。junction 行 `DO NOTHING`（与旧 seed「不删库里多出来的
 * 文档」同口径：只补缺，不回收）。app_key 与 admin 口令凭证沿用「缺了才造」的守卫。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { Client } from 'pg'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { buildPasswordIdentity, verifyPasswordIdentity } from './admin-credential.ts'
import { generateAppKeys } from './app-keys.ts'
import { parseCollectionFile } from './ejson.ts'
import { ETL_COLLECTION_ORDER, ETL_MAPPERS, JUNCTION_CONFLICT_TARGETS, preparePgParam, sortMenuRowsByDepth } from './etl-map.ts'
import { resolvePgTarget } from './pg-conn.ts'
import { listSeedCollections, resolvePath, SEED_DIR } from './seed.ts'
import { isObjectIdHex } from './uuid5.ts'

/**
 * junction 表 → 引用列与父表（悬空引用过滤用；两侧都有 FK）。原在 etl-mongo-to-pg.ts，
 *  Phase 5a 随 Mongo ETL 通道退役收编到本文件（唯一消费方）。
 */
export const JUNCTION_REFS: Record<string, Record<string, string>> = {
  sys_user_role: { user_id: 'sys_user', role_id: 'sys_role' },
  sys_role_menu: { role_id: 'sys_role', menu_id: 'sys_menu' },
}

/**
 * junction 悬空引用过滤。旧 Mongo 存量无 FK，可能存在指向**已被删除**父行的授权行；
 * PG 的 FK 装不进这些行 —— 丢弃并明示上报（不静默、不造假行）。seed 文件自洽时不会发生，
 * 这里是最后防线。返回合法行与被丢弃行（含原因），调用方负责打印。
 */
export async function splitDanglingJunctionRows(
  pg: Client,
  table: string,
  rows: readonly Record<string, unknown>[],
): Promise<{ valid: Record<string, unknown>[], dangling: { row: Record<string, unknown>, reason: string }[] }> {
  const refs = JUNCTION_REFS[table]
  if (refs === undefined)
    throw new ViolationError(`表 ${table} 不在 junction 引用注册表里`)
  if (rows.length === 0)
    return { valid: [], dangling: [] }

  const existingByCol = new Map<string, Set<string>>()
  for (const col of Object.keys(refs)) {
    const parentTable = refs[col]
    const ids = await pg.query<{ id: string }>(`SELECT id FROM ${parentTable}`)
    existingByCol.set(col, new Set(ids.rows.map(r => r.id)))
  }

  const valid: Record<string, unknown>[] = []
  const dangling: { row: Record<string, unknown>, reason: string }[] = []
  for (const row of rows) {
    const missing = Object.keys(refs).filter((col) => {
      const ids = existingByCol.get(col)
      return ids !== undefined && !ids.has(String(row[col]))
    })
    if (missing.length > 0)
      dangling.push({ row, reason: missing.map(col => `${col}=${String(row[col])} 在 ${refs[col]} 里不存在`).join('; ') })
    else
      valid.push(row)
  }
  return { valid, dangling }
}

export interface SeedPgOptions {
  seedDir: string
  envFile: string
  pgDbName?: string
  only?: string[]
  dryRun: boolean
  skipAppKeys: boolean
  admin?: string
  password?: string
}

export function parseSeedPgArgs(argv: readonly string[]): SeedPgOptions {
  const opts: SeedPgOptions = { seedDir: SEED_DIR, envFile: '', dryRun: false, skipAppKeys: false }
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
      case '--admin':
        opts.admin = next()
        break
      case '--password':
        opts.password = next()
        break
      case '--only':
        opts.only = next().split(',').map(s => s.trim()).filter(Boolean)
        break
      case '--pg-db':
        opts.pgDbName = next()
        break
      case '--env-file':
        opts.envFile = next()
        break
      case '--seed-dir':
        opts.seedDir = next()
        break
      default:
        throw new PreconditionError(`未知参数 ${arg}（支持 --dry-run / --skip-app-keys / --admin / --password / --only / --pg-db / --env-file / --seed-dir）`)
    }
  }
  return opts
}

/**
 * seed 目录 ∩ mapper 注册表，按 ETL 装载顺序排（FK 父表先播）。
 * 目录里不属于业务集合的文件（如 README 提到的杂项）直接忽略 —— seed 目录是「允许子集」。
 */
export function resolveSeedCollections(seedDir: string, only?: readonly string[]): { name: string, file: string }[] {
  if (!existsSync(seedDir))
    throw new PreconditionError(`找不到 seed 目录：${seedDir}`)
  const files = listSeedCollections(seedDir)
  const unknown = only?.filter(name => !ETL_COLLECTION_ORDER.includes(name) || !files.includes(name)) ?? []
  if (unknown.length > 0)
    throw new PreconditionError(`--only 里的集合不在 seed 目录或不认识：${unknown.join(', ')}`)
  const picked = files.filter(name => ETL_COLLECTION_ORDER.includes(name) && (only === undefined || only.includes(name)))
  if (picked.length === 0)
    throw new PreconditionError(`seed 目录里没有可播的集合（${seedDir}）`)
  return picked
    .map(name => ({ name, file: join(seedDir, `${name}.json`) }))
    .sort((a, b) => ETL_COLLECTION_ORDER.indexOf(a.name) - ETL_COLLECTION_ORDER.indexOf(b.name))
}

/**
 * upsert 语句：业务表 `(id) DO UPDATE`（整行刷新，除 id 外全列），junction 复合 PK `DO NOTHING`
 * （只补缺不回收）。**纯函数**（单测盯冲突目标与 SET 列表）。
 */
export function buildUpsertSql(table: string, cols: readonly string[], rowCount: number): string {
  const conflict = JUNCTION_CONFLICT_TARGETS[table]
  if (conflict === undefined && !ETL_COLLECTION_ORDER.includes(table))
    throw new ViolationError(`表 ${table} 既不是已注册集合也不是 junction 表 —— 拒绝构造 UPSERT`)
  const colList = cols.map(c => `"${c}"`).join(', ')
  const rows: string[] = []
  for (let r = 0; r < rowCount; r++) {
    const base = r * cols.length
    rows.push(`(${cols.map((_, c) => `$${base + c + 1}`).join(', ')})`)
  }
  if (conflict !== undefined)
    return `INSERT INTO ${table} (${colList}) VALUES ${rows.join(', ')} ON CONFLICT ${conflict} DO NOTHING`
  const updates = cols.filter(c => c !== 'id').map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')
  return `INSERT INTO ${table} (${colList}) VALUES ${rows.join(', ')} ON CONFLICT (id) DO UPDATE SET ${updates}`
}

export interface SeedPgCollectionStats {
  collection: string
  docs: number
  upserted: number
  junction: number
}

/** 播一个集合：读文件 → 映射 → upsert（单条多行语句；行数远小于 PG 参数上限） */
export async function seedPgCollection(pg: Client, name: string, file: string, ctx: EtlMapContext, dryRun: boolean): Promise<SeedPgCollectionStats> {
  const mapper = ETL_MAPPERS[name]
  const docs = parseCollectionFile(readFileSync(file, 'utf8'))
  const rows: Record<string, unknown>[] = []
  const junctionRows: Record<string, unknown>[] = []
  let junctionTable = ''
  for (const doc of docs) {
    const mapped = mapper(doc, ctx)
    if (mapped.table !== name)
      throw new ViolationError(`mapper 声明的目标表 ${mapped.table} 与集合 ${name} 不一致`)
    rows.push(mapped.row)
    if (mapped.junction !== undefined && mapped.junction.rows.length > 0) {
      junctionTable = mapped.junction.table
      junctionRows.push(...mapped.junction.rows)
    }
  }
  // pid 自引用 FK：sys_menu 的文件序不保证父前子后，按深度整理（与 ETL 同一份实现）
  const orderedRows = name === 'sys_menu' ? sortMenuRowsByDepth(rows) : rows

  if (dryRun)
    return { collection: name, docs: docs.length, upserted: 0, junction: 0 }

  let upserted = 0
  if (orderedRows.length > 0) {
    const cols = Object.keys(orderedRows[0])
    const params = orderedRows.flatMap(row => cols.map(col => preparePgParam(name, col, row[col])))
    const result = await pg.query(buildUpsertSql(name, cols, orderedRows.length), params)
    upserted = result.rowCount ?? 0
  }
  let junction = 0
  if (junctionTable !== '' && junctionRows.length > 0) {
    // 与 ETL 同一过滤：junction 行指向库里不存在的父行时丢弃并明示（seed 文件自洽时不会发生）
    const { valid, dangling } = await splitDanglingJunctionRows(pg, junctionTable, junctionRows)
    if (dangling.length > 0)
      out(`  ⚠ ${junctionTable} 丢弃 ${dangling.length} 行悬空引用（seed 文件引用了库里不存在的父行）`)
    const cols = Object.keys(valid[0])
    const params = valid.flatMap(row => cols.map(col => row[col]))
    const result = await pg.query(buildUpsertSql(junctionTable, cols, valid.length), params)
    junction = result.rowCount ?? 0
  }
  return { collection: name, docs: docs.length, upserted, junction }
}

/** app_key 现生成（PG 版）：库里没有 ACTIVE 的同类型密钥时才插入（id 走 DB 默认 v4） */
export async function seedPgAppKeys(pg: Client, dryRun: boolean): Promise<{ inserted: number, wanted: number }> {
  const wanted = generateAppKeys()
  let inserted = 0
  for (const keyDoc of wanted) {
    const exist = await pg.query('SELECT 1 FROM app_key WHERE type = $1 AND status = $2 LIMIT 1', [keyDoc.type, 'ACTIVE'])
    if (exist.rowCount !== 0 || dryRun)
      continue
    const row = {
      key: keyDoc.key,
      type: keyDoc.type,
      version: keyDoc.version,
      status: keyDoc.status,
      valid_start: keyDoc.validStart,
      valid_end: keyDoc.validEnd,
      rotate_after: keyDoc.rotateAfter,
      meta: keyDoc.meta,
      created_at: keyDoc.createdAt,
      updated_at: keyDoc.updatedAt,
    }
    const cols = Object.keys(row)
    const params = cols.map(col => row[col as keyof typeof row])
    await pg.query(`INSERT INTO app_key (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, params)
    inserted++
  }
  return { inserted, wanted: wanted.length }
}

/**
 * admin 口令凭证（PG 版）：凭给定的 userName 找 PG 用户，OPAQUE 注册后按
 * `uq_identity (user_id, type, purpose)` upsert，并用同一套协议验证登录握手。
 */
export async function seedPgAdminCredential(pg: Client, admin: string, password: string, serverSetup: string): Promise<void> {
  const found = await pg.query<{ id: string }>('SELECT id FROM sys_user WHERE user_name = $1', [admin])
  const user = found.rows[0]
  if (user === undefined)
    throw new PreconditionError(`PG 里没有账号 ${admin} —— 先跑 \`pnpm db:seed:pg\`（它会播演示账号档案），或换一个已存在的 userName`)

  let identity
  try {
    identity = buildPasswordIdentity(user.id, admin, password, serverSetup)
  }
  catch (error) {
    throw new PreconditionError(
      `拿本环境的 AUTH_OPAQUE_SECRET 跑 OPAQUE 注册失败（${error instanceof Error ? error.message : String(error)}）`
      + '\n  · 它必须是后端实际使用的那一份（--env-file 指向的 env 文件里的 AUTH_OPAQUE_SECRET）',
    )
  }

  const row = {
    user_id: identity.userId,
    type: identity.type,
    purpose: identity.purpose,
    value: identity.value,
    value_hash: identity.valueHash,
    masked_value: identity.maskedValue,
    verified: identity.verified,
    verified_at: identity.verifiedAt,
    is_primary: identity.isPrimary,
    status: identity.status,
    metadata: identity.metadata,
  }
  const cols = Object.keys(row)
  const params = cols.map(col => row[col as keyof typeof row])
  const updates = cols.filter(c => c !== 'user_id' && c !== 'type' && c !== 'purpose')
    .map(c => `"${c}" = EXCLUDED."${c}"`)
    .join(', ')
  await pg.query(
    `INSERT INTO sys_user_identity (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (user_id, type, purpose) DO UPDATE SET ${updates}, updated_at = now()`,
    params,
  )
  out(`  sys_user_identity  覆盖 1（账号 ${admin} 的口令凭证）`)

  const proof = verifyPasswordIdentity(admin, password, identity.value, serverSetup)
  if (!proof.ok) {
    throw new ViolationError(`凭证写进去了，但登录握手没通过：${proof.reason} —— 通常说明 AUTH_OPAQUE_SECRET 与后端实际使用的不一致`)
  }
  line('ok', `口令已验证：${admin} 用该口令能完成完整 OPAQUE 登录握手（会话密钥 ${proof.sessionKeyLength} 字节）`)
}

/** 命令行主体 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseSeedPgArgs(process.argv.slice(2))
  const seedDir = resolvePath(repoRoot, opts.seedDir)
  const collections = resolveSeedCollections(seedDir, opts.only)
  const { target } = resolvePgTarget(repoRoot, opts.envFile === '' ? undefined : opts.envFile, opts.pgDbName)

  // role hex 校验集：seed 通道的存量 role 就在仓里的 sys_role.json（ETL 通道从 Mongo 取，同源）
  const ctx = buildSeedContext(collections)

  out(`seed 目录：${opts.seedDir}（${collections.length} 个集合，按 ETL 装载顺序）`)
  out(`目标 PG 库：${target.database}${opts.dryRun ? '（dry-run，不写入）' : '（按 id upsert，幂等可重放）'}`)

  const pg = new Client(target)
  await pg.connect()
  try {
    const results: SeedPgCollectionStats[] = []
    for (const { name, file } of collections) {
      const stats = await seedPgCollection(pg, name, file, ctx, opts.dryRun)
      results.push(stats)
      out(`  ${name.padEnd(16)} 文档 ${stats.docs} / upsert ${stats.upserted}${stats.junction > 0 ? ` / junction ${stats.junction}` : ''}`)
    }

    if (!opts.skipAppKeys) {
      const keys = await seedPgAppKeys(pg, opts.dryRun)
      out(`  ${'app_key'.padEnd(16)} 现生成 ${keys.inserted} / ${keys.wanted}（缺 ACTIVE 才造）`)
    }

    if (opts.admin !== undefined) {
      const serverSetup = readOpaqueSecret(repoRoot, opts.envFile)
      const password = opts.password ?? process.env.SEED_ADMIN_PASSWORD
      if (password === undefined || password === '')
        throw new PreconditionError('--admin 需要配 --password（或环境变量 SEED_ADMIN_PASSWORD）')
      if (opts.dryRun)
        out(`  sys_user_identity  待写入（账号 ${opts.admin} 的口令凭证；dry-run 不生成也不验证）`)
      else
        await seedPgAdminCredential(pg, opts.admin, password, serverSetup)
    }

    line('ok', opts.dryRun ? 'dry-run 完成（未写入）' : `PG 播种完成：${results.length} 个集合`)
  }
  finally {
    await pg.end()
  }
}

/** 取本环境的 AUTH_OPAQUE_SECRET（口令凭证必须用后端实际使用的那一份生成） */
function readOpaqueSecret(repoRoot: string, envFileOverride: string): string {
  const { envFile } = resolvePgTarget(repoRoot, envFileOverride === '' ? undefined : envFileOverride)
  const text = readFileSync(envFile, 'utf8')
  const match = /^AUTH_OPAQUE_SECRET=(.+)$/m.exec(text)
  const secret = match?.[1]?.trim()
  if (secret === undefined || secret === '')
    throw new PreconditionError(`env 里没有 AUTH_OPAQUE_SECRET（${envFile}）—— 口令凭证必须用**本环境**的 OPAQUE 密钥生成`)
  return secret
}

/**
 * seed 通道的映射上下文：role hex 校验集取自仓里的 sys_role.json（app_setting 的 role 引用
 * 专项重写要用它；sys_role 不在播种清单时给空集 —— 此时 setting 里不该有 role 引用，真有会抛）。
 */
export function buildSeedContext(
  collections: readonly { name: string, file: string }[],
): EtlMapContext {
  const roleEntry = collections.find(entry => entry.name === 'sys_role')
  const roleHexes = new Set<string>()
  if (roleEntry !== undefined) {
    for (const doc of parseCollectionFile(readFileSync(roleEntry.file, 'utf8'))) {
      const hex = String(doc._id)
      if (isObjectIdHex(hex))
        roleHexes.add(hex)
    }
  }
  return { roleHexes }
}

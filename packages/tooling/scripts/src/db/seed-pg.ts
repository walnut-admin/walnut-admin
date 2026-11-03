/**
 * `db:seed:pg` —— 把 `apps/server/db/seed/` 的**初始化数据行**播种进 **PostgreSQL**（CI / 部署接线用）。
 *
 * ## 真源形态（2026-11 批次 5-B 起）
 *
 * seed 目录里每个文件就是一个 **PG 行数组**：`{ id, <snake_case 列>, … }`，时间列是 ISO 字符串，
 * jsonb 列是 JSON 值；`sys_user_role` / `sys_role_menu` 这两个 junction 表**各自一个文件**。
 * 于是本文件**不做任何字段映射**（旧 `seed-map.ts` 的 938 行已退役）：文件里是什么列，就写什么列。
 *
 * 列/主键/外键/jsonb 的判据全部**从 PG 元数据读**（`information_schema`），不在这里维护第二份注册表：
 * - 装载顺序 = 表间 FK 的拓扑序（父表先播）；
 * - 自引用 FK（`sys_menu.pid`）按深度稳定排序，保证父行先于子行；
 * - jsonb 列的对象/数组在绑参前 stringify（node-pg 会把 JS 数组序列化成 PG 数组字面量，jsonb 不认）；
 * - junction 表（主键里没有 `id`）走 `ON CONFLICT DO NOTHING`（只补缺不回收），业务表走
 *   `ON CONFLICT (id) DO UPDATE`（整行刷新为 seed 值）。
 *
 * ## 幂等
 *
 * 按主键 upsert：仓是 seed 集合的唯一真源，重放必须收敛到 seed 形态（集成测试每次跑两轮并核对计数）。
 * junction 行 `DO NOTHING`（与旧 seed「不删库里多出来的行」同口径：只补缺，不回收）。
 * app_key 与 admin 口令凭证沿用「缺了才造」的守卫。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { Client } from 'pg'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { buildPasswordIdentity, verifyPasswordIdentity } from './admin-credential.ts'
import { generateAppKeys } from './app-keys.ts'
import { resolvePgTarget } from './pg-conn.ts'
import { JUNCTION_TABLES, SEED_TABLES } from './seed-reshape.ts'
import { listSeedCollections, resolvePath, SEED_DIR } from './seed.ts'

// ---------------------------------------------------------------------------
// PG 元数据：列 / 主键 / 外键 / jsonb 的唯一判据（不维护第二份注册表）
// ---------------------------------------------------------------------------

export interface TableMeta {
  /** 列名（DDL 顺序） */
  columns: string[]
  /** NOT NULL 且无默认值的列 —— seed 行必须给值，缺了直接抛（不靠 PG 报错猜） */
  requiredColumns: string[]
  /** jsonb 列（绑参前要 stringify） */
  jsonbColumns: Set<string>
  /** 主键列（junction 表是复合主键，业务表是单列 id） */
  primaryKey: string[]
  /** 单列外键：列 → 被引用表 */
  fkRefs: Map<string, string>
  /** 自引用外键的列名（`sys_menu.pid` 这类），无则 null */
  selfRef: string | null
}

export async function readTableMeta(pg: Client, tables: readonly string[]): Promise<Map<string, TableMeta>> {
  const columns = (await pg.query<{ table_name: string, column_name: string, data_type: string, is_nullable: string, column_default: string | null }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1)
     ORDER BY table_name, ordinal_position`,
    [tables],
  )).rows

  const primaryKeys = (await pg.query<{ table_name: string, column_name: string }>(
    `SELECT tc.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
      AND kcu.table_name = tc.table_name
     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = ANY($1)
     ORDER BY tc.table_name, kcu.ordinal_position`,
    [tables],
  )).rows

  const foreignKeys = (await pg.query<{ table_name: string, column_name: string, ref_table: string, ref_column: string }>(
    `SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
      AND kcu.table_name = tc.table_name
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name = ANY($1)`,
    [tables],
  )).rows

  const meta = new Map<string, TableMeta>()
  for (const table of tables) {
    const cols = columns.filter(row => row.table_name === table)
    if (cols.length === 0)
      throw new PreconditionError(`PG 里没有表 ${table} —— 先跑 \`pnpm migration:run\`（seed 目录里有它的文件）`)
    const fkRefs = new Map<string, string>()
    let selfRef: string | null = null
    for (const fk of foreignKeys.filter(row => row.table_name === table)) {
      fkRefs.set(fk.column_name, fk.ref_table)
      if (fk.ref_table === table)
        selfRef = fk.column_name
    }
    meta.set(table, {
      columns: cols.map(row => row.column_name),
      requiredColumns: cols
        .filter(row => row.is_nullable === 'NO' && row.column_default === null)
        .map(row => row.column_name),
      jsonbColumns: new Set(cols.filter(row => row.data_type === 'jsonb').map(row => row.column_name)),
      primaryKey: primaryKeys.filter(row => row.table_name === table).map(row => row.column_name),
      fkRefs,
      selfRef,
    })
  }
  return meta
}

/**
 * 装载顺序：表间 FK 的拓扑序（被引用的表在前）。
 *
 * 只考虑**参与本次播种**的表之间的边（指向 sys_dept 这类未播种表的 FK 由 PG 兜底：值非空且父行
 * 不存在时 PG 会响亮报错，那是真脏数据，不该被静默跳过）。成环直接抛（seed 目录自相矛盾）。
 */
export function orderTablesByFk(tables: readonly string[], meta: ReadonlyMap<string, TableMeta>): string[] {
  const picked = new Set(tables)
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const ordered: string[] = []

  const visit = (table: string): void => {
    if (visited.has(table))
      return
    if (visiting.has(table))
      throw new ViolationError(`表的 FK 依赖成环：${[...visiting, table].join(' -> ')}`)
    visiting.add(table)
    for (const refTable of (meta.get(table)?.fkRefs ?? new Map()).values()) {
      if (picked.has(refTable) && refTable !== table)
        visit(refTable)
    }
    visiting.delete(table)
    visited.add(table)
    ordered.push(table)
  }

  // 入参顺序 = 文件名字典序（确定性），保证同一份 seed 目录每次排出同一个顺序
  for (const table of [...tables].sort())
    visit(table)
  return ordered
}

/** jsonb 列的对象/数组 → JSON 文本（node-pg 会把 JS 数组当 PG 数组字面量，jsonb 不认） */
export function prepareParam(value: unknown, isJsonb: boolean): unknown {
  if (!isJsonb)
    return value
  if (value !== null && typeof value === 'object')
    return JSON.stringify(value)
  return value
}

/**
 * `sys_menu.pid` 这类**自引用 FK** 的装载序整理：pid 指向的行必须先入库。
 * 按 pid 链算深度后稳定排序；成环 / pid 指向本次不存在的行直接抛（fail-closed —— PG 的 FK 是
 * 「立即检查」还是「语句末检查」不该被当成数据脏的借口）。
 */
export function sortRowsBySelfRefDepth(
  rows: readonly Record<string, unknown>[],
  column: string,
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>()
  for (const row of rows)
    byId.set(String(row.id), row)

  const depthCache = new Map<string, number>()

  const depthOf = (id: string, path: ReadonlySet<string>): number => {
    const cached = depthCache.get(id)
    if (cached !== undefined)
      return cached
    const row = byId.get(id)
    if (row === undefined)
      throw new ViolationError(`${column} 指向本次没有的行：${id} —— 先修 seed 数据`)
    const parent = row[column]
    if (parent === null || parent === undefined) {
      depthCache.set(id, 0)
      return 0
    }
    const parentKey = String(parent)
    if (path.has(parentKey))
      throw new ViolationError(`${column} 链成环：${[...path, parentKey].join(' -> ')} —— 先修 seed 数据`)
    const depth = 1 + depthOf(parentKey, new Set([...path, parentKey]))
    depthCache.set(id, depth)
    return depth
  }

  return [...rows]
    .map((row, index) => ({ row, index, depth: depthOf(String(row.id), new Set([String(row.id)])) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map(entry => entry.row)
}

/** 业务表 upsert：按 `id` 冲突整行刷新（除 id 外全列） */
export function buildBusinessUpsertSql(table: string, cols: readonly string[], rowCount: number): string {
  const colList = cols.map(c => `"${c}"`).join(', ')
  const rows = Array.from({ length: rowCount }, (_, r) =>
    `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(', ')})`)
  const updates = cols.filter(c => c !== 'id').map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')
  return `INSERT INTO ${table} (${colList}) VALUES ${rows.join(', ')} ON CONFLICT (id) DO UPDATE SET ${updates}`
}

/** junction 表插入：复合主键冲突即跳过（只补缺不回收） */
export function buildJunctionInsertSql(table: string, cols: readonly string[], rowCount: number, primaryKey: readonly string[]): string {
  if (primaryKey.length === 0)
    throw new ViolationError(`junction 表 ${table} 没有主键 —— ON CONFLICT 无从判重`)
  const colList = cols.map(c => `"${c}"`).join(', ')
  const rows = Array.from({ length: rowCount }, (_, r) =>
    `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(', ')})`)
  return `INSERT INTO ${table} (${colList}) VALUES ${rows.join(', ')} ON CONFLICT (${primaryKey.map(c => `"${c}"`).join(', ')}) DO NOTHING`
}

/**
 * junction 行的悬空引用过滤。`--only` 收窄播种面时（例如只播 sys_user 而不播 sys_role），
 * 引用可能指向库里不存在的父行 —— 那种行 PG 的 FK 装不进，丢弃并**明示上报**（不静默、不造假行）。
 * 业务表不做这层过滤：业务行的坏引用属于数据脏，必须响亮失败。
 */
export async function splitDanglingJunctionRows(
  pg: Client,
  table: string,
  rows: readonly Record<string, unknown>[],
  fkRefs: ReadonlyMap<string, string>,
): Promise<{ valid: Record<string, unknown>[], dangling: { row: Record<string, unknown>, reason: string }[] }> {
  if (rows.length === 0)
    return { valid: [], dangling: [] }

  const existingByCol = new Map<string, Set<string>>()
  for (const [col, parentTable] of fkRefs) {
    const ids = await pg.query<{ id: string }>(`SELECT id FROM ${parentTable}`)
    existingByCol.set(col, new Set(ids.rows.map(r => r.id)))
  }

  const valid: Record<string, unknown>[] = []
  const dangling: { row: Record<string, unknown>, reason: string }[] = []
  for (const row of rows) {
    const missing = [...fkRefs.keys()].filter((col) => {
      const ids = existingByCol.get(col)
      return ids !== undefined && !ids.has(String(row[col]))
    })
    if (missing.length > 0)
      dangling.push({ row, reason: missing.map(col => `${col}=${String(row[col])} 在 ${fkRefs.get(col)} 里不存在`).join('; ') })
    else
      valid.push(row)
  }
  return { valid, dangling }
}

// ---------------------------------------------------------------------------
// 播种
// ---------------------------------------------------------------------------

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

export interface SeedPlanEntry {
  table: string
  file: string
}

/**
 * seed 目录 → 本次要播的表。`--only` 只筛**业务集合**；junction 文件（`sys_user_role` /
 * `sys_role_menu`）永远跟着父集合一起播（它们是同一份数据的一部分，漏播等于丢权限）。
 * 排序 = FK 拓扑序（父表先播）。
 */
export function planSeedTables(seedDir: string, only?: readonly string[]): SeedPlanEntry[] {
  if (!existsSync(seedDir))
    throw new PreconditionError(`找不到 seed 目录：${seedDir}`)
  const files = listSeedCollections(seedDir)

  const unknown = only?.filter(name => !files.includes(name)) ?? []
  if (unknown.length > 0)
    throw new PreconditionError(`--only 里的集合不在 seed 目录：${unknown.join(', ')}`)

  const junctionOfParent = new Map<string, string>()
  for (const parent of SEED_TABLES) {
    // junction 与父集合的对应关系从文件名推：sys_user → sys_user_role、sys_role → sys_role_menu
    const junction = JUNCTION_TABLES.find(table => table.startsWith(`${parent}_`))
    if (junction !== undefined)
      junctionOfParent.set(junction, parent)
  }

  const picked = new Set<string>()
  for (const name of files) {
    if (SEED_TABLES.includes(name) && (only === undefined || only.includes(name))) {
      picked.add(name)
    }
    else if (JUNCTION_TABLES.includes(name)) {
      const parent = junctionOfParent.get(name)
      if (only === undefined || only.includes(name) || (parent !== undefined && only.includes(parent)))
        picked.add(name)
    }
    else if (!SEED_TABLES.includes(name)) {
      throw new PreconditionError(`seed 目录里有未登记的表文件 ${name}.json —— 先在 seed-reshape.ts 的 ROW_SPECS 里登记`)
    }
  }
  if (picked.size === 0)
    throw new PreconditionError(`seed 目录里没有可播的表（${seedDir}）`)

  // 拓扑序要元数据；这里先用文件名序做稳定兜底，readTableMeta 之后由 main 再排一次
  return [...picked].sort().map(table => ({ table, file: join(seedDir, `${table}.json`) }))
}

/** 读一个行形态的 seed 文件（纯 JSON：没有 `$oid` / `$date` 包装） */
export function readSeedRows(file: string): Record<string, unknown>[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
  if (!Array.isArray(parsed))
    throw new PreconditionError(`${file} 必须是行数组（JSON array）`)
  return parsed.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row))
      throw new PreconditionError(`${file} 第 ${index} 行不是对象`)
    return row as Record<string, unknown>
  })
}

/**
 * 一行的列集必须**逐行一致**且都是真实列 —— 否则多行 VALUES 的列数会错位（PG 报的错很难懂），
 * 或者某列被静默漏掉。
 */
export function resolveColumns(table: string, rows: readonly Record<string, unknown>[], meta: TableMeta): string[] {
  const first = rows[0]
  if (first === undefined)
    return []
  const cols = Object.keys(first)
  for (const [index, row] of rows.entries()) {
    const keys = Object.keys(row)
    if (keys.length !== cols.length || keys.some(key => !cols.includes(key)))
      throw new ViolationError(`${table} 第 ${index} 行的列集与首行不一致（列集必须逐行一致：${cols.join(', ')}）`)
  }
  const unknown = cols.filter(col => !meta.columns.includes(col))
  if (unknown.length > 0)
    throw new ViolationError(`${table} 的 seed 文件里有 PG 表中不存在的列：${unknown.join(', ')} —— 表结构变了就重新导出`)
  const missing = meta.requiredColumns.filter(col => !cols.includes(col))
  if (missing.length > 0)
    throw new ViolationError(`${table} 的 seed 文件缺 NOT NULL 列：${missing.join(', ')} —— 表结构变了就重新导出`)
  return cols
}

export interface SeedStats {
  table: string
  /** 文件里的行数 */
  rows: number
  /** 实际写入（upsert / insert）的行数 */
  upserted: number
  /** junction 表才有：被丢弃的悬空引用行数 */
  dangling: number
}

/** 播一张表（单条多行语句；行数远小于 PG 参数上限） */
export async function seedTable(pg: Client, table: string, file: string, meta: TableMeta, dryRun: boolean): Promise<SeedStats> {
  const rows = readSeedRows(file)
  const isJunction = !meta.primaryKey.includes('id')
  if (isJunction)
    return seedJunctionTable(pg, table, rows, meta, dryRun)

  const cols = resolveColumns(table, rows, meta)
  if (dryRun || rows.length === 0)
    return { table, rows: rows.length, upserted: 0, dangling: 0 }

  const ordered = meta.selfRef === null ? rows : sortRowsBySelfRefDepth(rows, meta.selfRef)
  const params = ordered.flatMap(row => cols.map(col => prepareParam(row[col], meta.jsonbColumns.has(col))))
  const result = await pg.query(buildBusinessUpsertSql(table, cols, ordered.length), params)
  return { table, rows: rows.length, upserted: result.rowCount ?? 0, dangling: 0 }
}

async function seedJunctionTable(
  pg: Client,
  table: string,
  rows: readonly Record<string, unknown>[],
  meta: TableMeta,
  dryRun: boolean,
): Promise<SeedStats> {
  const cols = resolveColumns(table, rows, meta)
  if (dryRun || rows.length === 0)
    return { table, rows: rows.length, upserted: 0, dangling: 0 }

  const { valid, dangling } = await splitDanglingJunctionRows(pg, table, rows, meta.fkRefs)
  if (valid.length === 0)
    return { table, rows: rows.length, upserted: 0, dangling: dangling.length }

  const params = valid.flatMap(row => cols.map(col => row[col]))
  const result = await pg.query(buildJunctionInsertSql(table, cols, valid.length, meta.primaryKey), params)
  return { table, rows: rows.length, upserted: result.rowCount ?? 0, dangling: dangling.length }
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
  const plan = planSeedTables(seedDir, opts.only)
  const { target } = resolvePgTarget(repoRoot, opts.envFile === '' ? undefined : opts.envFile, opts.pgDbName)

  out(`seed 目录：${opts.seedDir}（${plan.length} 个表文件，FK 拓扑序装载）`)
  out(`目标 PG 库：${target.database}${opts.dryRun ? '（dry-run，不写入）' : '（按主键 upsert，幂等可重放）'}`)

  const pg = new Client(target)
  await pg.connect()
  try {
    // 元数据是装载序、jsonb、必填列的唯一判据（不维护第二份注册表）
    const meta = await readTableMeta(pg, plan.map(entry => entry.table))
    const ordered = orderTablesByFk(plan.map(entry => entry.table), meta)

    const results: SeedStats[] = []
    for (const table of ordered) {
      const entry = plan.find(item => item.table === table)
      if (entry === undefined)
        throw new PreconditionError(`装载计划里没有表 ${table}（内部错误）`)
      const stats = await seedTable(pg, entry.table, entry.file, meta.get(entry.table) as TableMeta, opts.dryRun)
      results.push(stats)
      const extra = stats.dangling > 0 ? ` / 丢弃悬空 ${stats.dangling}` : ''
      out(`  ${table.padEnd(16)} 文档 ${stats.rows} / upsert ${stats.upserted}${extra}`)
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

    line('ok', opts.dryRun ? 'dry-run 完成（未写入）' : `PG 播种完成：${results.length} 个表`)
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

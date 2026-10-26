/**
 * `db:etl` —— MongoDB（walnut-admin-nestjs，只读）→ PostgreSQL（walnut_pg）的存量数据搬迁。
 *
 * ## 通道形态
 *
 * Mongo 逐集合游标读 → `etl-map.ts`（唯一映射层：`$date`→timestamptz、`$oid`/hex 引用→uuid v5、
 * menu.meta 拍平、junction 拆分、Q7 parse、Q4 setting_value 重写）→ PG 多行 INSERT。
 *
 * - **shared_area（66 万行）**：游标流式分批，每批 1000 行、独立事务（断在半路已提交的批不丢）；
 * - **其余小表**：数据量 ≤ 一批 ⇒ 自然单事务；
 * - junction 行（sys_user_role / sys_role_menu）整集合攒完**最后**写 —— 它们引用同集合的父行，
 *   交错写会在全新库上撞 FK。
 *
 * ## 幂等（两种模式）
 *
 * - 默认**增量幂等**：v5 确定性派生 + `ON CONFLICT DO NOTHING` —— 重跑不产生新行、不改旧行；
 * - `--fresh`：先一条 TRUNCATE 清空全部业务表（26 张，含 junction）再灌 —— 全量重建模式。
 *
 * **绝不写 walnut-admin-nestjs**：Mongo 连接只有 find/count，无任何写腿。
 */
import type { Db } from 'mongodb'
import type { MappedDoc } from './etl-map.ts'
import process from 'node:process'
import { MongoClient } from 'mongodb'
import { Client } from 'pg'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { err, line, out } from '../lib/log.ts'
import { ETL_COLLECTION_ORDER, ETL_MAPPERS, JUNCTION_CONFLICT_TARGETS, preparePgParam, sortMenuRowsByDepth } from './etl-map.ts'
import { resolveMongoTarget } from './mongo-conn.ts'
import { resolvePgTarget } from './pg-conn.ts'

/** PG 单条语句的参数上限（65535）；按列数换算每批行数的硬顶 */
const PG_PARAM_LIMIT = 65535
/** 每次打进度日志的批间隔 */
const PROGRESS_EVERY_BATCHES = 50

export interface EtlOptions {
  envFile: string
  uri?: string
  dbName?: string
  pgDbName?: string
  only?: string[]
  fresh: boolean
  batchSize: number
}

/** 解析 argv：未知参数直接报错（静默忽略的代价是"以为 fresh 了、其实增量"） */
export function parseEtlArgs(argv: readonly string[]): EtlOptions {
  const opts: EtlOptions = { envFile: '', fresh: false, batchSize: 1000 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[++i]
      if (value === undefined)
        throw new PreconditionError(`${arg} 后面缺参数值`)
      return value
    }
    switch (arg) {
      case '--fresh':
        opts.fresh = true
        break
      case '--batch-size': {
        const n = Number.parseInt(next())
        if (Number.isNaN(n) || n <= 0)
          throw new PreconditionError('--batch-size 需要正整数')
        opts.batchSize = n
        break
      }
      case '--only':
        opts.only = next().split(',').map(s => s.trim()).filter(Boolean)
        break
      case '--uri':
        opts.uri = next()
        break
      case '--db':
        opts.dbName = next()
        break
      case '--pg-db':
        opts.pgDbName = next()
        break
      case '--env-file':
        opts.envFile = next()
        break
      default:
        throw new PreconditionError(`未知参数 ${arg}（支持 --fresh / --batch-size / --only / --uri / --db / --pg-db / --env-file）`)
    }
  }
  return opts
}

/** 解析要搬的集合清单：必须在 mapper 注册表里；`--only` 收窄且保持装载顺序 */
export function resolveCollections(only?: readonly string[]): string[] {
  const collections = only === undefined
    ? [...ETL_COLLECTION_ORDER]
    : ETL_COLLECTION_ORDER.filter(name => only.includes(name))
  const unknown = only?.filter(name => !ETL_COLLECTION_ORDER.includes(name)) ?? []
  if (unknown.length > 0)
    throw new PreconditionError(`未知集合：${unknown.join(', ')}（可选项见 etl-map.ts 的 ETL_MAPPERS）`)
  if (collections.length === 0)
    throw new PreconditionError('--only 收窄后没有可搬的集合')
  return collections
}

/**
 * 一条多行 INSERT。`ON CONFLICT` 目标：业务表 `(id)`，junction 表用复合 PK
 * （目标由表名查 `JUNCTION_CONFLICT_TARGETS`，未知表直接抛 —— 防手滑对错误的目标去重）。
 * **纯函数**（单测盯占位符展开与冲突目标）。
 */
export function buildInsertSql(table: string, cols: readonly string[], rowCount: number): string {
  const conflict = JUNCTION_CONFLICT_TARGETS[table]
  if (conflict === undefined && !ETL_COLLECTION_ORDER.includes(table)) {
    throw new ViolationError(`表 ${table} 既不是已注册集合也不是 junction 表 —— 拒绝构造 INSERT`)
  }
  const target = conflict ?? '(id)'
  const colList = cols.map(c => `"${c}"`).join(', ')
  const rows: string[] = []
  for (let r = 0; r < rowCount; r++) {
    const base = r * cols.length
    rows.push(`(${cols.map((_, c) => `$${base + c + 1}`).join(', ')})`)
  }
  return `INSERT INTO ${table} (${colList}) VALUES ${rows.join(', ')} ON CONFLICT ${target} DO NOTHING`
}

/** 每批行数上限：用户给的 batchSize 与 PG 参数上限的较小者 */
export function effectiveBatchSize(table: string, cols: number, requested: number): number {
  const cap = Math.floor(PG_PARAM_LIMIT / cols)
  return Math.max(1, Math.min(requested, cap))
}

interface BatchWriter {
  write: (table: string, rows: Record<string, unknown>[]) => Promise<number>
}

/** 每批一个事务的多行 INSERT 写入器（ON CONFLICT DO NOTHING；返回实际插入行数） */
function createBatchWriter(pg: Client, requestedBatch: number): BatchWriter {
  return {
    async write(table, rows): Promise<number> {
      if (rows.length === 0)
        return 0
      const cols = Object.keys(rows[0])
      const size = effectiveBatchSize(table, cols.length, requestedBatch)
      let inserted = 0
      for (let i = 0; i < rows.length; i += size) {
        const chunk = rows.slice(i, i + size)
        const sql = buildInsertSql(table, cols, chunk.length)
        const params = chunk.flatMap(row => cols.map(col => preparePgParam(table, col, row[col])))
        await pg.query('BEGIN')
        try {
          const result = await pg.query(sql, params)
          inserted += result.rowCount ?? 0
          await pg.query('COMMIT')
        }
        catch (error) {
          await pg.query('ROLLBACK')
          throw error
        }
      }
      return inserted
    },
  }
}

/** junction 表 → 引用列与父表（悬空引用过滤用；两侧都有 FK） */
export const JUNCTION_REFS: Record<string, Record<string, string>> = {
  sys_user_role: { user_id: 'sys_user', role_id: 'sys_role' },
  sys_role_menu: { role_id: 'sys_role', menu_id: 'sys_menu' },
}

/**
 * junction 悬空引用过滤。Mongo 无 FK，存量里存在指向**已被删除**父行（如 sys_menu 里不存在的
 * menu hex）的角色授权；PG 的 FK 装不进这些行 —— 丢弃并明示上报（不静默、不造假行）。
 * 返回合法行与被丢弃行（含原因），调用方负责打印。
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

/** `--fresh`：一条 TRUNCATE 清空全部业务表（FK 关联表同语句清，不加 CASCADE 误伤库外表） */
export async function truncateBusinessTables(pg: Client): Promise<void> {
  const tables = [...ETL_COLLECTION_ORDER, ...Object.keys(JUNCTION_CONFLICT_TARGETS)]
  await pg.query(`TRUNCATE TABLE ${tables.join(', ')}`)
}

export interface EtlCollectionStats {
  collection: string
  mongoCount: number
  inserted: number
  junctionInserted: number
  /** junction 里因悬空引用被丢弃的行数（Mongo 无 FK 的存量脏数据，已在输出里明示） */
  junctionDangling: number
  pgCount: number
  ms: number
}

/** 搬一个集合：游标流式读 → 映射 → 分批写；junction 攒到最后统一写 */
export async function etlCollection(
  mongoDb: Db,
  pg: Client,
  name: string,
  ctx: { roleHexes: ReadonlySet<string> },
  batchSize: number,
): Promise<EtlCollectionStats> {
  const mapper = ETL_MAPPERS[name]
  if (mapper === undefined)
    throw new PreconditionError(`集合 ${name} 没有 mapper（etl-map.ts）`)
  const started = Date.now()
  const mongoCount = await mongoDb.collection(name).countDocuments({})
  if (mongoCount === 0) {
    return { collection: name, mongoCount: 0, inserted: 0, junctionInserted: 0, junctionDangling: 0, pgCount: 0, ms: Date.now() - started }
  }

  const writer = createBatchWriter(pg, batchSize)
  const junctionBuffer: Record<string, unknown>[] = []
  let junctionTable = ''
  let inserted = 0
  let seen = 0
  // sys_menu 的 pid 自引用 FK 要求父行先入库 —— 整集合攒完按深度排序再写（其余集合保持流式）
  const needsFullBuffer = name === 'sys_menu'

  const cursor = mongoDb.collection(name).find({}, { batchSize })
  let buffer: Record<string, unknown>[] = []
  let batchIndex = 0
  const flush = async (): Promise<void> => {
    if (buffer.length === 0)
      return
    inserted += await writer.write(name, buffer)
    buffer = []
    batchIndex++
    if (mongoCount > 10_000 && batchIndex % PROGRESS_EVERY_BATCHES === 0) {
      const rate = Math.round(seen / ((Date.now() - started) / 1000))
      out(`  ${name} 进度 ${seen} / ${mongoCount}（${rate} 行/秒）`)
    }
  }

  for await (const doc of cursor) {
    const mapped: MappedDoc = mapper(doc as Record<string, unknown>, ctx)
    if (mapped.table !== name)
      throw new ViolationError(`mapper 声明的目标表 ${mapped.table} 与集合 ${name} 不一致`)
    buffer.push(mapped.row)
    seen++
    if (mapped.junction !== undefined && mapped.junction.rows.length > 0) {
      junctionTable = mapped.junction.table
      junctionBuffer.push(...mapped.junction.rows)
    }
    if (!needsFullBuffer && buffer.length >= batchSize)
      await flush()
  }
  if (needsFullBuffer)
    buffer = sortMenuRowsByDepth(buffer)
  await flush()

  let junctionInserted = 0
  let danglingCount = 0
  if (junctionTable !== '') {
    const { valid, dangling } = await splitDanglingJunctionRows(pg, junctionTable, junctionBuffer)
    danglingCount = dangling.length
    if (dangling.length > 0) {
      err(`  ⚠ ${junctionTable} 丢弃 ${dangling.length} 行悬空引用（Mongo 无 FK 的存量脏数据，PG 装不进）：`)
      for (const d of dangling.slice(0, 10))
        err(`    - ${d.reason}`)
    }
    junctionInserted = (await writer.write(junctionTable, valid))
  }

  const pgCount = await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${name}`)
  return {
    collection: name,
    mongoCount,
    inserted,
    junctionInserted,
    junctionDangling: danglingCount,
    pgCount: Number.parseInt(pgCount.rows[0].n),
    ms: Date.now() - started,
  }
}

/** Mongo sys_role 存量 hex（setting_value 专项重写的校验集，与 B5 订正脚本同源口径） */
export async function collectRoleHexes(mongoDb: Db): Promise<Set<string>> {
  const roles = await mongoDb.collection('sys_role').find({}, { projection: { _id: 1 } }).toArray()
  return new Set(roles.map(role => String(role._id)))
}

/** 命令行主体：解析 env、连两个库、逐集合搬、打汇总 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseEtlArgs(process.argv.slice(2))
  const collections = resolveCollections(opts.only)

  const { uri, dbName } = resolveMongoTarget(repoRoot, { uri: opts.uri, dbName: opts.dbName, envFile: opts.envFile === '' ? undefined : opts.envFile })
  const { target: pgTarget } = resolvePgTarget(repoRoot, opts.envFile === '' ? undefined : opts.envFile, opts.pgDbName)

  out(`Mongo 源（只读）：${dbName}`)
  out(`PG 目标：${pgTarget.database}${opts.fresh ? '（--fresh：先清空全部业务表）' : '（增量幂等：ON CONFLICT DO NOTHING）'}`)
  out(`集合：${collections.length} 个，批次 ${opts.batchSize}`)

  const startedAt = Date.now()
  const mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  await mongoClient.connect()
  const pg = new Client(pgTarget)
  await pg.connect()

  try {
    if (opts.fresh)
      await truncateBusinessTables(pg)

    const roleHexes = await collectRoleHexes(mongoClient.db(dbName))
    const ctx = { roleHexes }
    const stats: EtlCollectionStats[] = []
    for (const name of collections) {
      out(`▸ ${name}`)
      const s = await etlCollection(mongoClient.db(dbName), pg, name, ctx, opts.batchSize)
      stats.push(s)
      const junctionNote = s.junctionInserted > 0 ? ` + junction ${s.junctionInserted}` : ''
      const danglingNote = s.junctionDangling > 0 ? `（丢弃悬空引用 ${s.junctionDangling}）` : ''
      out(`  mongo ${s.mongoCount} → pg 插入 ${s.inserted}${junctionNote}${danglingNote}，表内现有 ${s.pgCount} 行（${(s.ms / 1000).toFixed(1)}s）`)
    }

    const totalMs = Date.now() - startedAt
    const totalRows = stats.reduce((sum, s) => sum + s.inserted + s.junctionInserted, 0)
    const rate = Math.round(totalRows / (totalMs / 1000))
    out('')
    for (const s of stats) {
      out(`  ${s.collection.padEnd(20)} mongo ${String(s.mongoCount).padStart(7)} → pg ${String(s.pgCount).padStart(7)}${s.mongoCount !== s.pgCount ? '  ← 计数不一致' : ''}`)
    }
    out('')
    line('ok', `ETL 完成：${totalRows} 行 / ${(totalMs / 1000).toFixed(1)}s（平均 ${rate} 行/秒）；对账请跑 \`pnpm db:verify-etl\``)

    const mismatched = stats.filter(s => s.mongoCount !== s.pgCount)
    if (mismatched.length > 0) {
      throw new ViolationError(`${mismatched.length} 个集合计数不一致（${mismatched.map(s => s.collection).join(', ')}）—— 增量模式下多见于重复 id 以外的差异，跑 --fresh 或查明细`)
    }
  }
  finally {
    await Promise.all([mongoClient.close(), pg.end()])
  }
}

/**
 * `db:verify-etl` —— ETL 结果的三重对账（phase2 §7.3 口径的落地）：
 *
 * 1. **计数**：每个 Mongo 集合的 count vs PG 表 count；junction 行数 vs Mongo 数组总长
 *    （按去重后的引用计 —— 复合 PK 天然去重，重复赋值不产生第二行）；
 * 2. **抽样**：每集合随机取 `min(N, --sample)` 条 Mongo 文档，走**与 ETL 同一份映射**
 *    （`etl-map.ts`）再与 PG 行逐列比对 —— 引用列 v5 一致性、setting_value 重写、Q7 parse
 *    全部在这里被机械验证；
 * 3. **聚合**：locale 按 lang 计数、dict_data 按 type 计数、area 顶层（pcode='0'）计数、
 *    每用户角色数、menu 树节点数（含根节点数）。
 *
 * **fail-closed**：任何一条差异都进 findings，最后整体抛 `ViolationError`（退出码 1）。
 * 与 ETL 共用同一份映射层是本脚本成立的前提 —— 映射散抄一份，对账就变成「两个错互相背书」。
 */
import type { Db } from 'mongodb'
import process from 'node:process'
import { MongoClient } from 'mongodb'
import { Client } from 'pg'
import { ViolationError } from '../lib/errors.ts'
import { err, line, out } from '../lib/log.ts'
import { ETL_COLLECTION_ORDER, ETL_MAPPERS, refUuidOrNull } from './etl-map.ts'
import { resolveMongoTarget } from './mongo-conn.ts'
import { resolvePgTarget } from './pg-conn.ts'

export interface VerifyOptions {
  envFile: string
  uri?: string
  dbName?: string
  pgDbName?: string
  only?: string[]
  /** 每集合抽样上限（默认 20；实际取 min(集合行数, N)） */
  sampleSize: number
}

export function parseVerifyArgs(argv: readonly string[]): VerifyOptions {
  const opts: VerifyOptions = { envFile: '', sampleSize: 20 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[++i]
      if (value === undefined)
        throw new Error(`${arg} 后面缺参数值`)
      return value
    }
    switch (arg) {
      case '--sample': {
        const n = Number.parseInt(next())
        if (Number.isNaN(n) || n <= 0)
          throw new Error('--sample 需要正整数')
        opts.sampleSize = n
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
        throw new Error(`未知参数 ${arg}（支持 --sample / --only / --uri / --db / --pg-db / --env-file）`)
    }
  }
  return opts
}

// ---------------------------------------------------------------------------
// 比对原语
// ---------------------------------------------------------------------------

/** 两值等价：Date 按毫秒、数值宽容 int/float 表达、其余深度相等 */
export function valueEquals(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : a
    const tb = b instanceof Date ? b.getTime() : b
    return ta === tb
  }
  return deepEquals(a, b)
}

export function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b)
    return true
  if (typeof a === 'number' && typeof b === 'number')
    return Object.is(a, b)
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEquals(item, b[i]))
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>)
    const kb = Object.keys(b as Record<string, unknown>)
    if (ka.length !== kb.length)
      return false
    return ka.every(k => deepEquals((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

/** 期望行（映射产物）vs 实际行（PG），返回差异描述列表 */
export function diffRow(table: string, id: string, expected: Record<string, unknown>, actual: Record<string, unknown> | undefined): string[] {
  if (actual === undefined)
    return [`${table}/${id}: PG 里找不到该行`]
  const diffs: string[] = []
  for (const [col, want] of Object.entries(expected)) {
    if (!valueEquals(want, actual[col])) {
      diffs.push(`${table}/${id}.${col}: mongo侧=${preview(want)} pg侧=${preview(actual[col])}`)
    }
  }
  return diffs
}

function preview(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : JSON.stringify(value)
  const s = String(text)
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

// ---------------------------------------------------------------------------
// 三重校验
// ---------------------------------------------------------------------------

export interface VerifyContext {
  mongoDb: Db
  pg: Client
  roleHexes: ReadonlySet<string>
  sampleSize: number
}

export async function verifyCounts(ctx: VerifyContext, name: string): Promise<string[]> {
  const mongoCount = await ctx.mongoDb.collection(name).countDocuments({})
  const pgResult = await ctx.pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${name}`)
  const pgCount = Number.parseInt(pgResult.rows[0].n)
  if (mongoCount !== pgCount)
    return [`${name}: mongo ${mongoCount} 行 vs pg ${pgCount} 行`]
  return []
}

export async function verifyJunctionCounts(ctx: VerifyContext): Promise<string[]> {
  const diffs: string[] = []
  // junction 期望行数 = 各文档数组**去重且引用存在**的长度和（与 ETL 同口径：
  // 复合 PK 去重；悬空引用被 ETL 丢弃 —— Mongo 无 FK 能存、PG 装不进的存量脏数据）
  const checks = [
    { collection: 'sys_user', arrayField: 'roles', table: 'sys_user_role', refTable: 'sys_role', refCol: 'role_id', key: 'user_id' },
    { collection: 'sys_role', arrayField: 'menus', table: 'sys_role_menu', refTable: 'sys_menu', refCol: 'menu_id', key: 'role_id' },
  ] as const
  for (const check of checks) {
    const existingIds = new Set(
      (await ctx.pg.query<{ id: string }>(`SELECT id FROM ${check.refTable}`)).rows.map(r => r.id),
    )
    const docs = await ctx.mongoDb.collection(check.collection).find({}, { projection: { [check.arrayField]: 1 } }).toArray()
    let expected = 0
    let dangling = 0
    for (const doc of docs) {
      const arr = doc[check.arrayField]
      if (!Array.isArray(arr))
        continue
      const refs = new Set(arr.map(String))
      for (const ref of refs) {
        // Mongo hex 与 PG uuid 两侧口径：hex 经 v5 派生、已是 uuid（回灌）直通
        const refId = refUuidOrNull(ref, `${check.table}.${check.refCol}`)
        if (refId === null)
          continue
        if (existingIds.has(refId))
          expected++
        else
          dangling++
      }
    }
    const pgResult = await ctx.pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${check.table}`)
    const actual = Number.parseInt(pgResult.rows[0].n)
    if (expected !== actual)
      diffs.push(`${check.table}: mongo 有效引用合计 ${expected} 行 vs pg ${actual} 行`)
    if (dangling > 0)
      out(`  ⚠ ${check.table}: mongo 侧悬空引用 ${dangling} 条（ETL 已丢弃，PG 无对应父行）`)
  }
  return diffs
}

export async function verifySamples(ctx: VerifyContext, name: string): Promise<string[]> {
  const mapper = ETL_MAPPERS[name]
  const total = await ctx.mongoDb.collection(name).countDocuments({})
  if (total === 0)
    return []
  const n = Math.min(total, ctx.sampleSize)
  const docs = await ctx.mongoDb.collection(name).aggregate([{ $sample: { size: n } }]).toArray()
  const diffs: string[] = []
  for (const doc of docs) {
    const mapped = mapper(doc as Record<string, unknown>, { roleHexes: ctx.roleHexes })
    const found = await ctx.pg.query(`SELECT * FROM ${name} WHERE id = $1`, [mapped.row.id])
    diffs.push(...diffRow(name, String(mapped.row.id), mapped.row, found.rows[0]))
  }
  return diffs
}

export interface AggregateChecks {
  localeByLang: { lang: string, mongo: number, pg: number }[]
  dictDataByType: { type: string, mongo: number, pg: number }[]
  areaTopLevel: { mongo: number, pg: number }
  menuNodes: { total: { mongo: number, pg: number }, roots: { mongo: number, pg: number } }
}

export async function collectAggregates(ctx: VerifyContext): Promise<AggregateChecks> {
  const langs = await ctx.mongoDb.collection('sys_lang').find({}).toArray()
  const localeByLang = []
  for (const lang of langs) {
    const mongo = await ctx.mongoDb.collection('sys_locale').countDocuments({ langId: lang._id })
    const pg = await ctx.pg.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM sys_locale t JOIN sys_lang l ON t.lang_id = l.id WHERE l.lang = $1',
      [lang.lang],
    )
    localeByLang.push({ lang: String(lang.lang), mongo, pg: Number.parseInt(pg.rows[0].n) })
  }

  const types = await ctx.mongoDb.collection('sys_dict_type').find({}).toArray()
  const dictDataByType = []
  for (const type of types) {
    const mongo = await ctx.mongoDb.collection('sys_dict_data').countDocuments({ typeId: type._id })
    const pg = await ctx.pg.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM sys_dict_data d JOIN sys_dict_type t ON d.type_id = t.id WHERE t.type = $1',
      [type.type],
    )
    dictDataByType.push({ type: String(type.type), mongo, pg: Number.parseInt(pg.rows[0].n) })
  }

  const areaTopMongo = await ctx.mongoDb.collection('shared_area').countDocuments({ pcode: '0' })
  const areaTopPg = await ctx.pg.query<{ n: string }>('SELECT count(*)::text AS n FROM shared_area WHERE pcode = $1', ['0'])

  const menuTotalMongo = await ctx.mongoDb.collection('sys_menu').countDocuments({})
  const menuTotalPg = await ctx.pg.query<{ n: string }>('SELECT count(*)::text AS n FROM sys_menu')
  const menuRootsMongo = await ctx.mongoDb.collection('sys_menu').countDocuments({ $or: [{ pid: { $exists: false } }, { pid: null }] })
  const menuRootsPg = await ctx.pg.query<{ n: string }>('SELECT count(*)::text AS n FROM sys_menu WHERE pid IS NULL')

  return {
    localeByLang,
    dictDataByType,
    areaTopLevel: { mongo: areaTopMongo, pg: Number.parseInt(areaTopPg.rows[0].n) },
    menuNodes: {
      total: { mongo: menuTotalMongo, pg: Number.parseInt(menuTotalPg.rows[0].n) },
      roots: { mongo: menuRootsMongo, pg: Number.parseInt(menuRootsPg.rows[0].n) },
    },
  }
}

export function aggregateDiffs(checks: AggregateChecks): string[] {
  const diffs: string[] = []
  for (const row of checks.localeByLang) {
    if (row.mongo !== row.pg)
      diffs.push(`locale 按 lang=${row.lang}: mongo ${row.mongo} vs pg ${row.pg}`)
  }
  for (const row of checks.dictDataByType) {
    if (row.mongo !== row.pg)
      diffs.push(`dict_data 按 type=${row.type}: mongo ${row.mongo} vs pg ${row.pg}`)
  }
  if (checks.areaTopLevel.mongo !== checks.areaTopLevel.pg)
    diffs.push(`area 顶层(pcode='0'): mongo ${checks.areaTopLevel.mongo} vs pg ${checks.areaTopLevel.pg}`)
  if (checks.menuNodes.total.mongo !== checks.menuNodes.total.pg)
    diffs.push(`menu 树节点总数: mongo ${checks.menuNodes.total.mongo} vs pg ${checks.menuNodes.total.pg}`)
  if (checks.menuNodes.roots.mongo !== checks.menuNodes.roots.pg)
    diffs.push(`menu 根节点数: mongo ${checks.menuNodes.roots.mongo} vs pg ${checks.menuNodes.roots.pg}`)
  return diffs
}

/** 命令行主体 */
export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseVerifyArgs(process.argv.slice(2))
  const collections = opts.only === undefined
    ? [...ETL_COLLECTION_ORDER]
    : ETL_COLLECTION_ORDER.filter(name => opts.only?.includes(name))
  if (collections.length === 0)
    throw new ViolationError('--only 收窄后没有可对账的集合')

  const { uri, dbName } = resolveMongoTarget(repoRoot, { uri: opts.uri, dbName: opts.dbName, envFile: opts.envFile === '' ? undefined : opts.envFile })
  const { target: pgTarget } = resolvePgTarget(repoRoot, opts.envFile === '' ? undefined : opts.envFile, opts.pgDbName)

  out(`对账：mongo ${dbName} ⇄ pg ${pgTarget.database}（抽样上限 ${opts.sampleSize}/集合）`)

  const mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  await mongoClient.connect()
  const pg = new Client(pgTarget)
  await pg.connect()

  try {
    const roles = await mongoClient.db(dbName).collection('sys_role').find({}, { projection: { _id: 1 } }).toArray()
    const ctx: VerifyContext = {
      mongoDb: mongoClient.db(dbName),
      pg,
      roleHexes: new Set(roles.map(role => String(role._id))),
      sampleSize: opts.sampleSize,
    }

    const findings: string[] = []
    for (const name of collections) {
      const countDiffs = await verifyCounts(ctx, name)
      const sampleDiffs = await verifySamples(ctx, name)
      findings.push(...countDiffs, ...sampleDiffs)
      const mark = countDiffs.length + sampleDiffs.length === 0 ? '一致' : '不一致'
      out(`  ${name.padEnd(20)} ${mark}${countDiffs.length + sampleDiffs.length > 0 ? `（${countDiffs.length + sampleDiffs.length} 处差异）` : ''}`)
    }

    findings.push(...await verifyJunctionCounts(ctx))
    const aggregates = await collectAggregates(ctx)
    findings.push(...aggregateDiffs(aggregates))

    out(`  聚合校验：locale 按语言 ${aggregates.localeByLang.length} 组、dict_data 按类型 ${aggregates.dictDataByType.length} 组、area 顶层 ${aggregates.areaTopLevel.pg}、menu 节点 ${aggregates.menuNodes.total.pg}（根 ${aggregates.menuNodes.roots.pg}）`)

    if (findings.length > 0) {
      err(`\n对账差异 ${findings.length} 处：`)
      for (const finding of findings.slice(0, 50))
        err(`  - ${finding}`)
      if (findings.length > 50)
        err(`  …（其余 ${findings.length - 50} 处省略）`)
      throw new ViolationError(`ETL 对账存在 ${findings.length} 处差异 —— 拒绝放行`)
    }

    line('ok', `对账零差异：${collections.length} 个集合（计数 + 抽样 ≤${opts.sampleSize}/集合 + 聚合全部一致）`)
  }
  finally {
    await Promise.all([mongoClient.close(), pg.end()])
  }
}

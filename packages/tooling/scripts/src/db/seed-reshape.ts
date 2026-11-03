import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { parseCollectionFile } from './ejson.ts'
import { resolvePath, SEED_DIR } from './seed.ts'
import { UUID_RE } from './uuid5.ts'

/** 一列的来源：`'meta.order'` 表示从文档的 `meta` 子对象取 `order`，缺省（第二项省略）= 与列同名 */
export type RowSpec = ReadonlyArray<readonly [column: string, from?: string]>

/** 公共时间戳片段：每个业务表都有 `created_at` / `updated_at`（导出键是驼峰） */
const TIMESTAMPS: RowSpec = [['created_at', 'createdAt'], ['updated_at', 'updatedAt']]

/**
 * 逐表的列序与来源。**列序 = 落盘顺序**（人读的第一列是 `id`），不是 DDL 顺序 —— 两者在灌库时等价
 * （INSERT 显式列名），但文件 diff 时 `id` 在最上面更好 review。
 */
export const ROW_SPECS: Record<string, RowSpec> = {
  app_setting: [
    ['id', '_id'],
    ['setting_name', 'settingName'],
    ['setting_key', 'settingKey'],
    ['setting_value', 'settingValue'],
    ['setting_type', 'settingType'],
    ['remark'],
    ['created_by', 'createdBy'],
    ...TIMESTAMPS,
  ],
  sys_dict_data: [
    ['id', '_id'],
    ['type_id', 'typeId'],
    ['label'],
    ['value'],
    ['sort_order', 'order'],
    ['status'],
    ['tag_type', 'tagType'],
    ['description'],
    ...TIMESTAMPS,
  ],
  sys_dict_type: [
    ['id', '_id'],
    ['name'],
    ['type'],
    ['status'],
    ['description'],
    ...TIMESTAMPS,
  ],
  sys_lang: [
    ['id', '_id'],
    ['lang'],
    ['description'],
    ['sort_order', 'order'],
    ['status'],
    ...TIMESTAMPS,
  ],
  sys_locale: [
    ['id', '_id'],
    ['lang_id', 'langId'],
    ['key'],
    ['value'],
    ...TIMESTAMPS,
  ],
  sys_menu: [
    ['id', '_id'],
    ['pid'],
    ['type'],
    ['path'],
    ['name'],
    ['component'],
    ['title'],
    ['icon'],
    ['sort_order', 'meta.order'],
    ['ternal', 'meta.ternal'],
    ['url', 'meta.url'],
    ['is_show', 'meta.show'],
    ['cache', 'meta.cache'],
    ['status', 'meta.status'],
    ['affix', 'meta.affix'],
    ['permission', 'meta.permission'],
    ['menu_active_name', 'meta.menuActiveName'],
    ['menu_active_same_tab', 'meta.menuActiveSameTab'],
    ['badge', 'meta.badge'],
    ['active_icon', 'meta.activeIcon'],
    ['position', 'meta.position'],
    ['leave_tip', 'meta.leaveTip'],
    ['mask_url', 'meta.maskUrl'],
    ['hijack_refresh', 'meta.hijackRefresh'],
    ['watermark', 'meta.watermark'],
    ['transition', 'meta.transition'],
    ['cache_key_strategy', 'meta.cacheKeyStrategy'],
    ...TIMESTAMPS,
  ],
  sys_role: [
    ['id', '_id'],
    ['role_name', 'roleName'],
    ['description'],
    ['sort_order', 'order'],
    ['status'],
    ['data_scope', 'dataScope'],
    ...TIMESTAMPS,
  ],
  sys_user: [
    ['id', '_id'],
    ['user_name', 'userName'],
    ['nick_name', 'nickName'],
    ['age'],
    ['gender'],
    ['avatar'],
    ['description'],
    ['status'],
    ['role_mode', 'roleMode'],
    ['current_role_id', 'currentRole'],
    ['mfa_setup', 'mfaSetup'],
    ...TIMESTAMPS,
  ],
}

/** junction 文件：父文档里的引用数组 → 独立文件（复合主键，无 `id` 列） */
export interface JunctionSpec {
  /** 输出文件名（= junction 表名） */
  table: string
  /** 父文档里承载引用数组的键 */
  arrayKey: string
  /** 两列：父 id 列与子 id 列（顺序即列序） */
  columns: readonly [string, string]
}

export const JUNCTION_SPECS: Record<string, JunctionSpec> = {
  sys_role: { table: 'sys_role_menu', arrayKey: 'menus', columns: ['role_id', 'menu_id'] },
  sys_user: { table: 'sys_user_role', arrayKey: 'roles', columns: ['user_id', 'role_id'] },
}

/** 业务集合名（= 表名），按字母序 —— 装载顺序由 PG 的 FK 图决定，不靠这个顺序 */
export const SEED_TABLES: readonly string[] = Object.keys(ROW_SPECS).sort()

/** junction 表名 */
export const JUNCTION_TABLES: readonly string[] = Object.values(JUNCTION_SPECS).map(spec => spec.table).sort()

export interface ReshapedCollection {
  /** 业务行（列名 → 值，可直接 JSON 序列化） */
  rows: Record<string, unknown>[]
  /** junction 独立文件；没有引用数组时为空数组 */
  junctions: { table: string, rows: Record<string, unknown>[] }[]
}

/** `id` / `*_id` 列必须 uuid 或 null —— 钉住「导出通道输出的已是 uuid 本体」 */
function assertUuidOrNull(column: string, value: unknown, where: string): void {
  if (value === null)
    return
  if (typeof value !== 'string' || !UUID_RE.test(value))
    throw new ViolationError(`${where}.${column} 必须是 uuid 或 null，收到：${String(value)}（导出通道应输出 uuid 本体）`)
}

/** 值转换：`Date` → ISO 字符串（timestamptz 由 PG 解析 ISO）；对象/数组递归；`undefined` fail-closed */
export function toSeedValue(value: unknown, where: string): unknown {
  if (value === undefined)
    throw new ViolationError(`${where} 在导出文档里缺键 —— 字段表（seed-reshape.ts ROW_SPECS）与导出器必须同步`)
  if (value instanceof Date)
    return value.toISOString()
  if (Array.isArray(value))
    return value.map((item, index) => toSeedValue(item, `${where}[${index}]`))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value))
      out[key] = toSeedValue(item, `${where}.${key}`)
    return out
  }
  return value
}

/** 按 `a.b.c` 取文档里的键（导出器的 `meta` 拍平方向） */
function readSource(doc: Record<string, unknown>, from: string): unknown {
  const [head, ...rest] = from.split('.')
  let value: unknown = doc[head]
  for (const key of rest) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw new ViolationError(`导出文档的 ${head} 不是对象，取不到 ${from}`)
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

/**
 * 一个集合的历史导出文档数组 → 行形态。
 *
 * 未消费的键一律抛：这是「导出器加了字段但 reshape 没跟」的**唯一**拦口（丢一列是静默的）。
 */
export function reshapeCollection(collection: string, docs: readonly Record<string, unknown>[]): ReshapedCollection {
  const spec = ROW_SPECS[collection]
  if (spec === undefined)
    throw new ViolationError(`集合 ${collection} 不在 ROW_SPECS 里 —— 新集合要先登记列映射`)
  const junction = JUNCTION_SPECS[collection]

  // 消费到的**顶层键**：identity 列消费同名键，'meta.x' 消费 'meta'，junction 数组也算消费
  const consumedRoots = new Set(spec.map(([column, from]) => (from ?? column).split('.')[0]))
  if (junction !== undefined)
    consumedRoots.add(junction.arrayKey)

  const rows: Record<string, unknown>[] = []
  const junctionRows: Record<string, unknown>[] = []

  for (const [index, doc] of docs.entries()) {
    const where = `${collection}[${index}]`
    const row: Record<string, unknown> = {}
    for (const [column, from] of spec) {
      const source = from ?? column
      const value = toSeedValue(readSource(doc, source), `${where}.${source}`)
      if (column === 'id' || column.endsWith('_id'))
        assertUuidOrNull(column, value, where)
      row[column] = value
    }

    const leftovers = Object.keys(doc).filter(key => !consumedRoots.has(key) && key !== '_id')
    if (leftovers.length > 0)
      throw new ViolationError(`${where} 有未消费的键：${leftovers.join(', ')} —— 先把它加进 seed-reshape.ts 的 ROW_SPECS`)

    rows.push(row)

    if (junction !== undefined) {
      const parentId = String(row.id)
      const refs = doc[junction.arrayKey]
      if (refs !== undefined && refs !== null) {
        if (!Array.isArray(refs))
          throw new ViolationError(`${where}.${junction.arrayKey} 不是数组`)
        const seen = new Set<string>()
        for (const ref of refs) {
          if (typeof ref !== 'string' || !UUID_RE.test(ref))
            throw new ViolationError(`${where}.${junction.arrayKey} 里的 ${String(ref)} 不是 uuid`)
          // 复合主键天然去重：同一引用出现两次只落一行（与旧 seed-map 的 dedupeKeepOrder 同口径）
          if (seen.has(ref))
            continue
          seen.add(ref)
          junctionRows.push({ [junction.columns[0]]: parentId, [junction.columns[1]]: ref })
        }
      }
    }
  }

  return {
    rows,
    junctions: junction === undefined ? [] : [{ table: junction.table, rows: junctionRows }],
  }
}

/** 行数组 → 集合文件文本（稳定 2 空格缩进 + 结尾换行，便于 diff） */
export function stringifySeedRows(rows: readonly Record<string, unknown>[]): string {
  return `${JSON.stringify(rows, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// CLI：\`db:seed:reshape\` —— 历史导出目录 → 行形态 seed 目录（**再生成真源的唯一路径**）
// ---------------------------------------------------------------------------

export interface SeedReshapeOptions {
  /** 历史导出目录（\`db:export:pg --out\` 的产物，Extended JSON） */
  from: string
  /** 输出目录（默认仓内 seed 目录） */
  to: string
}

export function parseSeedReshapeArgs(argv: readonly string[]): SeedReshapeOptions {
  const opts: SeedReshapeOptions = { from: '', to: SEED_DIR }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[++i]
      if (value === undefined)
        throw new PreconditionError(`${arg} 后面缺参数值`)
      return value
    }
    switch (arg) {
      case '--from':
        opts.from = next()
        break
      case '--to':
        opts.to = next()
        break
      default:
        throw new PreconditionError(`未知参数 ${arg}（支持 --from / --to）`)
    }
  }
  if (opts.from === '')
    throw new PreconditionError('必须用 --from 指定历史导出目录（\`db:export:pg --out\` 的产物）')
  return opts
}

/** 读一个导出文件并拍平成行（导出文件是 Extended JSON 文档数组：\`_id\` 已是 uuid、时间是 \`{$date}\`） */
export function reshapeExportFile(path: string): ReshapedCollection {
  const collection = path.replace(/^.*[\\/]/, '').replace(/\.json$/, '')
  return reshapeCollection(collection, parseCollectionFile(readFileSync(path, 'utf8')))
}

export async function main(): Promise<void> {
  const repoRoot = process.cwd()
  const opts = parseSeedReshapeArgs(process.argv.slice(2))
  const fromDir = resolvePath(repoRoot, opts.from)
  const toDir = resolvePath(repoRoot, opts.to)

  const files = readdirSync(fromDir).filter(file => file.endsWith('.json')).sort()
  if (files.length === 0)
    throw new PreconditionError(`${opts.from} 里没有 .json —— 先跑 \`pnpm db:export:pg --out ${opts.from}\``)

  const collections = files.map(file => file.replace(/\.json$/, ''))
  const unknown = collections.filter(name => !SEED_TABLES.includes(name))
  if (unknown.length > 0)
    throw new PreconditionError(`导出目录里有未登记的集合：${unknown.join(', ')} —— 先在 seed-reshape.ts 的 ROW_SPECS 里登记列映射`)

  out(`拍平 ${collections.length} 个集合：${opts.from} -> ${opts.to}（行形态 + junction 独立文件）`)
  mkdirSync(toDir, { recursive: true })

  for (const collection of collections) {
    const { rows, junctions } = reshapeExportFile(join(fromDir, `${collection}.json`))
    writeFileSync(join(toDir, `${collection}.json`), stringifySeedRows(rows))
    let junctionNote = ''
    for (const junction of junctions) {
      writeFileSync(join(toDir, `${junction.table}.json`), stringifySeedRows(junction.rows))
      junctionNote += ` / ${junction.table} ${junction.rows.length}`
    }
    out(`  ${collection.padEnd(16)} ${String(rows.length).padStart(6)} 行${junctionNote}`)
  }

  // 导出里缺失的表**不删**仓内文件（删是不可恢复的动作，交给人决定；--only 收窄导出时会走到这里）
  const missing = SEED_TABLES.filter(name => !collections.includes(name))
  if (missing.length > 0)
    out(`  注意：导出里没有 ${missing.join(', ')} —— 仓内对应文件未改动（导出用 --only 收窄过？）`)

  line('ok', `seed 拍平完成：${collections.length} 个集合（PG 行形态，junction 已独立成文件）`)
}

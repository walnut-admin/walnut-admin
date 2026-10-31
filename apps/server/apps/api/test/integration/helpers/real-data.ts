import type { WriteStream } from 'node:fs'
import type { DataSource } from 'typeorm'
import * as fs from 'node:fs'
import { createReadStream, createWriteStream } from 'node:fs'
import * as path from 'node:path'
import { createInterface } from 'node:readline/promises'

import { DataSource as TypeOrmDataSource } from 'typeorm'

/**
 * `TEST_DATA=real`：把开发库（`DATABASE_PG_NAME`，默认 walnut_pg）的**全量业务数据**
 * 搬进集成库，替代 seed 层。默认关闭 —— seed 层快、稳、与部署参考数据同源；real
 * 模式用于「真实体量断言」（shared_area 66 万行等），单跑 `-- real-data` suite。
 *
 * ## 为什么不是 pg_dump/pg_restore
 *
 * 本机（Windows + WSL 容器）没有 pg_dump 可执行文件：WSL 里 docker 需要 sudo 密码
 * （非交互不可用）、宿主 Windows 也没有 PostgreSQL client。搬数因此走 PG 协议本身：
 * 管理角色连接源库，按主键 keyset 分页 `SELECT`，逐行写 JSONL（dump 文件落在
 * gitignored 的 `.tmp/integration-real-dump/`）；恢复端在同一角色的连接上
 * `SET session_replication_role = 'replica'` 关掉 FK 触发器后批量 `INSERT`。
 *
 * ## 角色与 RLS
 *
 * 两端都用**管理角色**（`DATABASE_PG_USER`，superuser / BYPASSRLS）：读到的是全量行，
 * 写入也绕开 RLS。应用运行时仍以 `DATABASE_PG_APP_USER`（walnut_app）连接，迁移建好的
 * RLS 策略在 HTTP 路径上照常生效 —— 「灌数用管理角色、运行用应用角色」与 globalSetup
 * 建库/迁移的既有口径一致。
 *
 * ## 幂等与失败
 *
 * 恢复前 `TRUNCATE ... RESTART IDENTITY CASCADE`（排除 `migrations`，迁移状态保留），
 * 重复执行收敛到同一份 dump；任一表行数不一致直接抛（附 dump 目录与表名）。
 */
const DUMP_DIR_RELATIVE = path.join('apps', 'server', '.tmp', 'integration-real-dump')
const METADATA_FILE = 'metadata.json'
const PAGE_SIZE = 2000
const MAX_PARAMS = 20_000

interface DumpColumn {
  name: string
  dataType: string
  udtName: string
}

interface DumpTable {
  name: string
  columns: DumpColumn[]
  pk: string[]
  rowCount: number
}

interface DumpMetadata {
  sourceDatabase: string
  generatedAt: string
  tables: DumpTable[]
}

export interface RealDataOptions {
  repoRoot: string
  host: string
  port: number
  /** 管理角色（与迁移/seed 同一个 DATABASE_PG_USER） */
  adminUser: string
  adminPass: string
  /** 源库：开发库（walnut_pg） */
  sourceDatabase: string
  /** 目标库：集成库 walnut-admin-integration */
  targetDatabase: string
}

export interface RealDataResult {
  dumpDir: string
  dumpMs: number
  restoreMs: number
  tableCount: number
  rowCount: number
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function createDataSource(options: RealDataOptions, database: string): DataSource {
  return new TypeOrmDataSource({
    type: 'postgres',
    host: options.host,
    port: options.port,
    username: options.adminUser,
    password: options.adminPass,
    database,
    synchronize: false,
    migrations: [],
    logging: ['error'],
  })
}

/** keyset 分页读一张表：`WHERE pk > last ORDER BY pk LIMIT n`（无 OFFSET 的 O(n²) 扫描） */
async function dumpTable(source: DataSource, table: DumpTable, file: string): Promise<number> {
  const pk = table.pk.map(quoteIdent).join(', ')
  const orderBy = table.pk.map(quoteIdent).join(', ')
  const stream = createWriteStream(file, { encoding: 'utf8' })
  const writer = new BufferedLineWriter(stream)
  let last: unknown[] | null = null
  let count = 0

  try {
    for (;;) {
      const where = last === null
        ? ''
        : ` WHERE (${pk}) > (${table.pk.map((_, index) => `$${index + 1}`).join(', ')})`
      const params = last === null ? [PAGE_SIZE] : [...last, PAGE_SIZE]
      const rows: Record<string, unknown>[] = await source.query(
        `SELECT * FROM ${quoteIdent(table.name)}${where} ORDER BY ${orderBy} LIMIT $${params.length}`,
        params,
      )
      if (rows.length === 0) {
        break
      }

      for (const row of rows) {
        await writer.write(`${JSON.stringify(row)}\n`)
        count++
      }
      const lastRow = rows[rows.length - 1]
      last = table.pk.map(column => lastRow[column])
      if (rows.length < PAGE_SIZE) {
        break
      }
    }
  }
  finally {
    await writer.close()
  }

  return count
}

/** 行缓冲写入：每行 `await` 一次 write 回调太慢，攒成块后按 drain 节流 */
class BufferedLineWriter {
  private buffer: string[] = []
  private bufferedChars = 0

  constructor(private readonly stream: WriteStream) { }

  async write(line: string): Promise<void> {
    this.buffer.push(line)
    this.bufferedChars += line.length
    if (this.buffer.length >= 5000 || this.bufferedChars >= 4 * 1024 * 1024) {
      await this.flush()
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return
    }
    const chunk = this.buffer.join('')
    this.buffer = []
    this.bufferedChars = 0
    await new Promise<void>((resolve, reject) => {
      this.stream.write(chunk, error => (error === null || error === undefined ? resolve() : reject(error)))
    })
  }

  async close(): Promise<void> {
    await this.flush()
    await new Promise<void>((resolve, reject) => {
      this.stream.once('error', reject)
      this.stream.end(() => resolve())
    })
  }
}

async function readTableMeta(source: DataSource): Promise<DumpTable[]> {
  const tableRows: Array<{ name: string }> = await source.query(
    `SELECT table_name AS name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migrations'
      ORDER BY table_name`,
  )

  const columnRows: Array<{ table_name: string, column_name: string, data_type: string, udt_name: string }>
    = await source.query(
      `SELECT table_name, column_name, data_type, udt_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`,
    )

  const pkRows: Array<{ table_name: string, column_name: string }> = await source.query(
    `SELECT c.relname AS table_name, a.attname AS column_name
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN LATERAL unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE n.nspname = 'public' AND i.indisprimary
      ORDER BY c.relname, k.ord`,
  )

  const columnsByTable = new Map<string, DumpColumn[]>()
  for (const row of columnRows) {
    const list = columnsByTable.get(row.table_name) ?? []
    list.push({ name: row.column_name, dataType: row.data_type, udtName: row.udt_name })
    columnsByTable.set(row.table_name, list)
  }

  const pkByTable = new Map<string, string[]>()
  for (const row of pkRows) {
    const list = pkByTable.get(row.table_name) ?? []
    list.push(row.column_name)
    pkByTable.set(row.table_name, list)
  }

  return tableRows.map(({ name }) => {
    const columns = columnsByTable.get(name)
    const pk = pkByTable.get(name)
    if (columns === undefined || pk === undefined || pk.length === 0) {
      throw new Error(`[integration][real] 表 ${name} 缺少列元数据或主键 —— 无法按 keyset 分页 dump`)
    }
    return { name, columns, pk, rowCount: 0 }
  })
}

async function dumpSource(options: RealDataOptions, dumpDir: string): Promise<DumpMetadata> {
  const source = createDataSource(options, options.sourceDatabase)
  await source.initialize()
  try {
    // 管理角色通常已是 superuser / BYPASSRLS；显式 off 让误配成普通角色时**响亮失败**
    // （与 db:export:pg 同口径），而不是静默导出少行
    await source.query('SET row_security = off')

    const tables = await readTableMeta(source)
    for (const table of tables) {
      table.rowCount = await dumpTable(source, table, path.join(dumpDir, `${table.name}.jsonl`))
    }

    const metadata: DumpMetadata = {
      sourceDatabase: options.sourceDatabase,
      generatedAt: new Date().toISOString(),
      tables,
    }
    fs.writeFileSync(path.join(dumpDir, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
    return metadata
  }
  finally {
    await source.destroy()
  }
}

function prepareValue(column: DumpColumn, value: unknown): unknown {
  if (value === null || value === undefined) {
    return null
  }
  // jsonb 数组/对象显式 stringify：node-pg 对 JS 数组会按 PG 数组字面量序列化，
  // 对 jsonb 列就是 invalid input（seed 通道的 JSONB_COLUMNS 是同一个坑的解法）
  if ((column.dataType === 'json' || column.dataType === 'jsonb') && typeof value === 'object') {
    return JSON.stringify(value)
  }
  return value
}

async function restoreTable(
  runner: ReturnType<DataSource['createQueryRunner']>,
  table: DumpTable,
  file: string,
): Promise<number> {
  const columnList = table.columns.map(column => quoteIdent(column.name)).join(', ')
  const batchSize = Math.max(1, Math.min(PAGE_SIZE, Math.floor(MAX_PARAMS / table.columns.length)))
  let batch: unknown[][] = []
  let inserted = 0

  const flush = async (): Promise<void> => {
    if (batch.length === 0) {
      return
    }
    const placeholders: string[] = []
    const params: unknown[] = []
    for (const row of batch) {
      const slot = table.columns.map((column, index) => {
        params.push(prepareValue(column, row[index]))
        return `$${params.length}`
      })
      placeholders.push(`(${slot.join(', ')})`)
    }
    await runner.query(
      `INSERT INTO ${quoteIdent(table.name)} (${columnList}) VALUES ${placeholders.join(', ')}`,
      params,
    )
    inserted += batch.length
    batch = []
  }

  const input = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  try {
    for await (const line of input) {
      if (line === '') {
        continue
      }
      const parsed = JSON.parse(line) as Record<string, unknown>
      batch.push(table.columns.map(column => parsed[column.name]))
      if (batch.length >= batchSize) {
        await flush()
      }
    }
    await flush()
  }
  finally {
    input.close()
  }

  return inserted
}

async function restoreIntoIntegration(
  options: RealDataOptions,
  metadata: DumpMetadata,
  dumpDir: string,
): Promise<number> {
  const target = createDataSource(options, options.targetDatabase)
  await target.initialize()
  const runner = target.createQueryRunner()
  await runner.connect()
  let total = 0

  try {
    await runner.query('SET statement_timeout = 0')
    await runner.query('SET row_security = off')
    // FK 触发器关闭后再灌：dump 的字典序不保证父表先于子表（含 junction 表）
    await runner.query(`SET session_replication_role = 'replica'`)

    const tableList = metadata.tables.map(table => quoteIdent(table.name)).join(', ')
    if (tableList !== '') {
      await runner.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`)
    }

    for (const table of metadata.tables) {
      const file = path.join(dumpDir, `${table.name}.jsonl`)
      const inserted = await restoreTable(runner, table, file)
      if (inserted !== table.rowCount) {
        throw new Error(
          `[integration][real] 表 ${table.name} 行数不一致：dump=${table.rowCount} restore=${inserted}（dump 目录 ${dumpDir}）`,
        )
      }
      total += inserted
    }
  }
  finally {
    try {
      await runner.query(`SET session_replication_role = 'origin'`)
    }
    catch {
      // 连接即将释放，还原失败不掩盖真实的恢复错误
    }
    await runner.release()
    await target.destroy()
  }

  return total
}

/** 全量 dump + restore（调用方：integration/helpers/global-setup.ts） */
export async function loadRealDataIntoIntegration(options: RealDataOptions): Promise<RealDataResult> {
  const dumpDir = path.join(options.repoRoot, DUMP_DIR_RELATIVE)
  fs.rmSync(dumpDir, { recursive: true, force: true })
  fs.mkdirSync(dumpDir, { recursive: true })

  const dumpStartedAt = Date.now()
  const metadata = await dumpSource(options, dumpDir)
  const dumpMs = Date.now() - dumpStartedAt
  const dumpedRows = metadata.tables.reduce((sum, table) => sum + table.rowCount, 0)
  console.log(
    `[integration][real] dump 完成 ${dumpMs}ms：${metadata.tables.length} 张表 / ${dumpedRows} 行`
    + `（源库 ${options.sourceDatabase} -> ${dumpDir}）`,
  )

  const restoreStartedAt = Date.now()
  const restoredRows = await restoreIntoIntegration(options, metadata, dumpDir)
  const restoreMs = Date.now() - restoreStartedAt
  console.log(
    `[integration][real] restore 完成 ${restoreMs}ms：${metadata.tables.length} 张表 / ${restoredRows} 行`
    + `（应用连接仍以 walnut_app 走 RLS）`,
  )

  return {
    dumpDir,
    dumpMs,
    restoreMs,
    tableCount: metadata.tables.length,
    rowCount: restoredRows,
  }
}

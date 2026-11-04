import * as fs from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'

import { DataSource } from 'typeorm'

import { INTEGRATION_DATABASE_NAME } from './integration.const'
import { loadRealDataIntoIntegration } from './real-data'
import { findRepoRoot, seedIntegrationDatabase } from './seed-layer'

/**
 * vitest globalSetup（跑在主进程，不加载 Nest DI 容器）：
 *
 * PG：对独立集成库（同一 PG 实例、`walnut-admin-integration`）**编程式**跑 migration ——
 * 每轮先 drop 再 run；并额外做一轮「undo 全部 → drop → 重跑」验证 migration 可逆
 * （等价 CI 里 `migration:run` + `migration:revert` 双向验证，phase2 第 6 节）。
 * teardown 对称 drop。
 * （Mongo 集成库的 drop 腿已随 Phase 5a 摘除 MongoDB 一并移除。）
 *
 * 结构建好后灌业务数据（两条互斥腿）：
 * - 默认：seed 层（7 个参考数据集合，复用 `db:seed:pg` CLI 的映射；含幂等重放）；
 * - `TEST_DATA=real`：dev 库全量 dump/restore（含 shared_area 66 万行），供只读
 *   `real-data` suite 用。默认不开 —— seed 快、稳，且不会把部署配置带进零配置契约。
 *
 * 读写 env 直接解析 `env-local/.env.development`：主进程没有 ConfigModule，
 * 不能依赖 dotenvx 之外的东西（也不引入新依赖）。
 *
 * **排他**：整个 run 由一把 PG advisory lock 独占（`acquireIntegrationRunLock`）—— 同一
 * worktree / 同一 PG 上同时只允许一个 `test:integration`（`test:e2e` 用同一份 globalSetup，
 * 同一把锁）：拿不到锁就轮询等待，超时报错退出并打印持锁者（`pg_locks` ×
 * `pg_stat_activity`）。理由与取舍见下面 `INTEGRATION_RUN_LOCK_KEY` 的注释。
 */
function envLocalPath(): string {
  return path.resolve(process.cwd(), 'env-local', '.env.development')
}

function readEnvLocal(key: string): string {
  const envPath = envLocalPath()

  if (!fs.existsSync(envPath)) {
    throw new Error(`[integration globalSetup] env file not found: ${envPath} (run \`pnpm setup-env\` first)`)
  }

  const line = fs.readFileSync(envPath, 'utf-8')
    .split(/\r?\n/)
    .find(l => l.startsWith(`${key}=`))

  if (line === undefined) {
    throw new Error(`[integration globalSetup] missing ${key} in ${envPath}`)
  }

  return line.slice(key.length + 1).trim()
}

/** migration 目录：与 data-source.cli.ts 同源（migration 属于应用部署物，跟 api app 走） */
const MIGRATIONS_GLOB = path.resolve(process.cwd(), 'apps/api/migrations/*.ts')

function createAdminDataSource(host: string, port: number, user: string, pass: string): DataSource {
  // 管理通道连维护库 postgres（不能 drop / create 自己正连着的库）
  return new DataSource({
    type: 'postgres',
    host,
    port,
    username: user,
    password: pass,
    database: 'postgres',
  })
}

async function dropPgIntegrationDatabase(admin: DataSource): Promise<void> {
  // WITH (FORCE) 杀掉残留连接后删库（PG 13+），兜底上次异常退出留下的连接
  await admin.query(`DROP DATABASE IF EXISTS "${INTEGRATION_DATABASE_NAME}" WITH (FORCE)`)
}

async function createPgIntegrationDatabase(admin: DataSource): Promise<void> {
  await admin.query(`CREATE DATABASE "${INTEGRATION_DATABASE_NAME}"`)
}

/**
 * 本轮排他锁（PG **session 级** advisory lock，键值常量）。
 *
 * 为什么需要：集成库是**共享单实例**（`walnut-admin-integration`），globalSetup 一进来就
 * `DROP DATABASE ... WITH (FORCE)`。两个 `test:integration` 同时跑会互相删库 —— 2026-11 实测
 * 另一个进程把库从脚下 drop 掉，日志里 285 处 `database "walnut-admin-integration" does not exist`，
 * 整轮读数因此不可信。
 *
 * 与 drop/create 流程**不冲突**：锁连接连的是维护库 `postgres`（与 drop/create 的管理通道同库），
 * 而 `WITH (FORCE)` 只杀**目标库**上的连接；advisory lock 本身按库分区，所以两个进程必须在同
 * 一个库上抢同一把锁才互斥 —— 这也是「锁连接必须连 postgres」的原因。
 *
 * 替代方案（未采用）：创建前探测库是否存在 + 明确报错。探测有 TOCTOU 窗口（探测到不存在，
 * 另一个进程随后建库/建表，本轮再 drop 掉），排不住；advisory lock 是内核里的原子状态，
 * 且进程异常退出时随连接自动释放，不需要任何清理逻辑。
 */
const INTEGRATION_RUN_LOCK_KEY = 730_942_001
/** 等锁上限：超时**报错退出**（并打印持锁者），不无限静默阻塞 —— 挂住的 CI 比失败更难查 */
const INTEGRATION_RUN_LOCK_WAIT_MS = 120_000
const INTEGRATION_RUN_LOCK_POLL_MS = 1_000

/**
 * 排他锁专用连接：**单连接**、跟随整个 run 存活。
 * advisory lock 是**会话级**的 —— 连接一关锁就没了，所以 pool 必须锁死在 1 条连接上
 * （`max: 1` + `min: 1` + 关掉 idle 回收），否则「抢锁」与「放锁」可能落到不同连接上，
 * unlock 会静默变成 no-op、锁随空闲连接被回收而提前消失。
 */
function createRunLockDataSource(host: string, port: number, user: string, pass: string): DataSource {
  return new DataSource({
    type: 'postgres',
    host,
    port,
    username: user,
    password: pass,
    database: 'postgres',
    extra: { max: 1, min: 1, idleTimeoutMillis: 0, keepAlive: true },
  })
}

/** 抢排他锁：拿不到就轮询等待，超时报错退出并把**持锁者**打出来 */
async function acquireIntegrationRunLock(host: string, port: number, user: string, pass: string): Promise<DataSource> {
  const lock = createRunLockDataSource(host, port, user, pass)
  await lock.initialize()

  const startedAt = Date.now()
  let announced = false

  for (;;) {
    const rows: Array<{ locked: boolean }> = await lock.query(
      'SELECT pg_try_advisory_lock($1::bigint) AS locked',
      [INTEGRATION_RUN_LOCK_KEY],
    )

    if (rows[0]?.locked === true) {
      break
    }

    if (!announced) {
      announced = true
      process.stdout.write(
        `[integration globalSetup] 另一个 test:integration 正在跑 —— 开始等锁（key=${INTEGRATION_RUN_LOCK_KEY}，最长 ${INTEGRATION_RUN_LOCK_WAIT_MS / 1000}s）\n`,
      )
    }

    if (Date.now() - startedAt >= INTEGRATION_RUN_LOCK_WAIT_MS) {
      const holders = await describeLockHolders(lock).catch((e: unknown) => `  （查持锁者失败：${String(e)}）`)
      await lock.destroy().catch(() => undefined)
      throw new Error(
        `[integration globalSetup] 等锁超时（${INTEGRATION_RUN_LOCK_WAIT_MS / 1000}s）：另一个 test:integration 仍在跑。\n`
        + `拒绝并发跑：集成库 "${INTEGRATION_DATABASE_NAME}" 是共享的，本轮的 drop/create 会删掉对方的库。\n`
        + `持锁者：\n${holders}\n`
        + '规矩见 apps/server/AGENTS.md「测试」小节：同一 worktree 同时只允许一个 test:integration。',
      )
    }

    await new Promise(resolve => setTimeout(resolve, INTEGRATION_RUN_LOCK_POLL_MS))
  }

  process.stdout.write(
    `[integration globalSetup] 已拿到排他锁（key=${INTEGRATION_RUN_LOCK_KEY}，等待 ${Math.round((Date.now() - startedAt) / 1000)}s）\n`,
  )

  return lock
}

/** 放锁 + 关连接（`pg_advisory_unlock` 之后连接关闭还会再兜一次，正常退出路径不依赖后者） */
async function releaseIntegrationRunLock(lock: DataSource): Promise<void> {
  try {
    await lock.query('SELECT pg_advisory_unlock($1::bigint)', [INTEGRATION_RUN_LOCK_KEY])
  }
  finally {
    await lock.destroy()
  }
}

/** 打印持锁者（`pg_locks` × `pg_stat_activity`）—— 报错要能回答「是谁在跑」 */
async function describeLockHolders(lock: DataSource): Promise<string> {
  const rows: Array<{
    pid: number
    application_name: string | null
    usename: string | null
    db: string | null
    client_addr: string | null
    state: string | null
    query: string | null
  }> = await lock.query(
    `SELECT a.pid,
            a.application_name,
            a.usename,
            d.datname       AS db,
            host(a.client_addr) AS client_addr,
            a.state,
            left(a.query, 200) AS query
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
       LEFT JOIN pg_database d ON d.oid = l.database
      WHERE l.locktype = 'advisory'
        AND l.granted
        AND l.objsubid = 1
        AND ((l.classid::bigint << 32) | l.objid::bigint) = $1::bigint`,
    [INTEGRATION_RUN_LOCK_KEY],
  )

  if (rows.length === 0) {
    return '  （pg_locks 里没看到持锁者：可能刚释放，或持锁进程已退出）'
  }

  return rows
    .map(row => `  pid=${row.pid} app=${row.application_name ?? '-'} user=${row.usename ?? '-'} db=${row.db ?? '-'} addr=${row.client_addr ?? 'local'} state=${row.state ?? '-'} query=${row.query ?? '-'}`)
    .join('\n')
}

function createPgIntegrationDataSource(host: string, port: number, user: string, pass: string): DataSource {
  return new DataSource({
    type: 'postgres',
    host,
    port,
    username: user,
    password: pass,
    database: INTEGRATION_DATABASE_NAME,

    // 迁移只管结构：与 data-source.cli.ts 同约定，synchronize 锁死 false
    synchronize: false,
    migrations: [MIGRATIONS_GLOB],
    logging: ['error'],
  })
}

/** undo 全部已执行 migration（undoLastMigration 每次回退一条，循环到 migrations 表为空） */
async function undoAllMigrations(ds: DataSource): Promise<void> {
  const safetyCap = 100
  for (let i = 0; i < safetyCap; i++) {
    const rows: Array<{ count: number }> = await ds.query('SELECT count(*)::int AS count FROM public.migrations')
    if (rows[0] === undefined || rows[0].count === 0) {
      return
    }
    await ds.undoLastMigration({ transaction: 'each' })
  }
  throw new Error('[integration globalSetup] undoAllMigrations exceeded safety cap')
}

async function runPgMigrationsRound(host: string, port: number, user: string, pass: string): Promise<void> {
  const admin = createAdminDataSource(host, port, user, pass)
  await admin.initialize()
  try {
    await dropPgIntegrationDatabase(admin)
    await createPgIntegrationDatabase(admin)

    const ds = createPgIntegrationDataSource(host, port, user, pass)
    await ds.initialize()
    try {
      await ds.runMigrations({ transaction: 'each' })
      // 可逆性验证：undo 全部，剩给下一轮的必须是空库
      await undoAllMigrations(ds)
    }
    finally {
      await ds.destroy()
    }

    await dropPgIntegrationDatabase(admin)
    await createPgIntegrationDatabase(admin)

    const finalDs = createPgIntegrationDataSource(host, port, user, pass)
    await finalDs.initialize()
    try {
      await finalDs.runMigrations({ transaction: 'each' })
    }
    finally {
      await finalDs.destroy()
    }
  }
  finally {
    await admin.destroy()
  }
}

async function setupPgIntegrationDatabase(): Promise<void> {
  const host = readEnvLocal('DATABASE_PG_HOST')
  const port = Number.parseInt(readEnvLocal('DATABASE_PG_PORT'))
  const user = readEnvLocal('DATABASE_PG_USER')
  const pass = readEnvLocal('DATABASE_PG_PASS')

  await runPgMigrationsRound(host, port, user, pass)

  const repoRoot = findRepoRoot(process.cwd())
  if (process.env.TEST_DATA === 'real') {
    await loadRealDataIntoIntegration({
      repoRoot,
      host,
      port,
      adminUser: user,
      adminPass: pass,
      sourceDatabase: readEnvLocal('DATABASE_PG_NAME'),
      targetDatabase: INTEGRATION_DATABASE_NAME,
    })
    return
  }

  await seedIntegrationDatabase({
    repoRoot,
    envFile: envLocalPath(),
    database: INTEGRATION_DATABASE_NAME,
  })
}

async function teardownPgIntegrationDatabase(): Promise<void> {
  const host = readEnvLocal('DATABASE_PG_HOST')
  const port = Number.parseInt(readEnvLocal('DATABASE_PG_PORT'))
  const user = readEnvLocal('DATABASE_PG_USER')
  const pass = readEnvLocal('DATABASE_PG_PASS')

  const admin = createAdminDataSource(host, port, user, pass)
  await admin.initialize()
  try {
    await dropPgIntegrationDatabase(admin)
  }
  finally {
    await admin.destroy()
  }
}

export default async function globalIntegrationSetup(): Promise<() => Promise<void>> {
  const host = readEnvLocal('DATABASE_PG_HOST')
  const port = Number.parseInt(readEnvLocal('DATABASE_PG_PORT'))
  const user = readEnvLocal('DATABASE_PG_USER')
  const pass = readEnvLocal('DATABASE_PG_PASS')

  // 排他窗口：从 drop/create 之前一直占到 teardown 的 drop 之后（见 INTEGRATION_RUN_LOCK_KEY 注释）
  const runLock = await acquireIntegrationRunLock(host, port, user, pass)

  try {
    await setupPgIntegrationDatabase()
  }
  catch (error) {
    // 建库失败也要放锁：不让一次早退把同 worktree 的下一次跑批挡在门外
    await releaseIntegrationRunLock(runLock).catch(() => undefined)
    throw error
  }

  return async () => {
    try {
      await teardownPgIntegrationDatabase()
    }
    finally {
      await releaseIntegrationRunLock(runLock)
    }
  }
}

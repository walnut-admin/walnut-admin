import * as fs from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'

import { DataSource } from 'typeorm'

import { INTEGRATION_DATABASE_NAME } from './integration.const'

/**
 * vitest globalSetup（跑在主进程，不加载 Nest DI 容器）：
 *
 * PG：对独立集成库（同一 PG 实例、`walnut-admin-integration`）**编程式**跑 migration ——
 * 每轮先 drop 再 run；并额外做一轮「undo 全部 → drop → 重跑」验证 migration 可逆
 * （等价 CI 里 `migration:run` + `migration:revert` 双向验证，phase2 第 6 节）。
 * teardown 对称 drop。
 * （Mongo 集成库的 drop 腿已随 Phase 5a 摘除 MongoDB 一并移除。）
 *
 * 读写 env 直接解析 `env-local/.env.development`：主进程没有 ConfigModule，
 * 不能依赖 dotenvx 之外的东西（也不引入新依赖）。
 */
function readEnvLocal(key: string): string {
  const envPath = path.resolve(process.cwd(), 'env-local', '.env.development')

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
  await setupPgIntegrationDatabase()
  return async () => {
    await teardownPgIntegrationDatabase()
  }
}

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'

import { connect, connection } from 'mongoose'

import { INTEGRATION_DATABASE_NAME } from './integration.const'

/**
 * vitest globalSetup（跑在主进程，不加载 Nest DI 容器）：
 *
 * - 开跑前 drop 一次集成库 —— 清掉上次异常退出残留的脏数据（demoString 等
 *   unique 索引会挡住重跑），保证幂等；
 * - 返回 teardown：全部文件跑完后统一 drop，仓库里不留集成垃圾库。
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

async function dropIntegrationDatabase(): Promise<void> {
  const user = readEnvLocal('DATABASE_USER')
  const pass = readEnvLocal('DATABASE_PASS')
  const primary = readEnvLocal('DATABASE_PRIMARY')
  const secondary = readEnvLocal('DATABASE_SECONDARY')
  const arbiter = readEnvLocal('DATABASE_ARBITER')
  const replicaSet = readEnvLocal('DATABASE_REPLICASET')
  const authSource = readEnvLocal('DATABASE_SOURCE')

  const uri = `mongodb://${user}:${pass}@${primary},${secondary},${arbiter}`

  await connect(uri, {
    dbName: INTEGRATION_DATABASE_NAME,
    authSource,
    replicaSet,
  })

  // 双保险：连上的不是集成库就立刻断开并失败，绝不 drop 任何别的库
  const dbName = connection.db?.databaseName
  if (dbName !== INTEGRATION_DATABASE_NAME) {
    await connection.close()
    throw new Error(`[integration globalSetup] expected dbName "${INTEGRATION_DATABASE_NAME}", got "${dbName}" — refusing to drop`)
  }

  await connection.dropDatabase()
  await connection.close()
}

export default async function globalIntegrationSetup(): Promise<() => Promise<void>> {
  await dropIntegrationDatabase()
  return dropIntegrationDatabase
}

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'

import { DataSource } from 'typeorm'

/**
 * TypeORM migration 专用 CLI 数据源（`pnpm migration:run` / `migration:revert` 的 `-d` 入口）。
 *
 * 与运行时 `WalnutPGConfigService`（libs/db/src/pg.service.ts）的**同源约定**：
 * - 连接四要素读同一组 `DATABASE_PG_*` 环境变量；
 * - **但角色不同**（数据权限三期）：本文件是迁移/管理通道，必须用 `DATABASE_PG_USER`
 *   （DDL 需要建表/建角色权限）；运行时走 `DATABASE_PG_APP_USER`（NOSUPERUSER
 *   NOBYPASSRLS，受 RLS 约束）。两通道分离是 RLS 生效的前提，不要把这里切到 app 角色；
 * - `synchronize: false` 同样硬编码（phase2 第 6 节：schema 演进一律走迁移，不给开口子）；
 * - `entities: []`：B0a 子批实体只建不注册，后续批次接线时在此补全（autoLoadEntities 是
 *   Nest 运行时机制，CLI 数据源必须显式列出）。
 *
 * 与运行时的**差异**（为什么不经 ConfigModule）：
 * - typeorm CLI 以 Node 原生类型剥离直接执行本文件（仓库禁 tsx，ADR 0019），没有 Nest DI
 *   容器，也没有 dotenvx 的运行时注入 —— 所以用纯 `node:fs` 手动解析 env 文件，解析模式与
 *   集成测试 `global-setup.ts` 的 `readEnvLocal` 一致（简单行解析，够用且零依赖）。
 * - env 文件定位与 `config.module.ts` 同约定：`process.cwd()` 下的 `env-local/.env.${NODE_ENV}`，
 *   **因此本文件只应从 apps/server/ 目录运行**（package.json scripts 已保证）。
 *
 * 本文件会被 Node 以模块检测判定为 ESM（含 `export default`），并经 typeorm 的
 * `importOrRequireFile` 加载 —— 语法上只允许可剥离（erasable）的 TS：不用 enum /
 * 参数属性 / 装饰器 / namespace。
 */

function readEnvLocal(key: string): string {
  const env = process.env.NODE_ENV ?? 'development'
  const envPath = path.resolve(process.cwd(), 'env-local', `.env.${env}`)

  if (!fs.existsSync(envPath)) {
    throw new Error(`[data-source.cli] env file not found: ${envPath} (run \`pnpm setup-env\` first)`)
  }

  const line = fs.readFileSync(envPath, 'utf-8')
    .split(/\r?\n/)
    .find(l => l.startsWith(`${key}=`))

  if (line === undefined) {
    throw new Error(`[data-source.cli] missing ${key} in ${envPath}`)
  }

  return line.slice(key.length + 1).trim()
}

export default new DataSource({
  type: 'postgres',
  host: readEnvLocal('DATABASE_PG_HOST'),
  port: Number.parseInt(readEnvLocal('DATABASE_PG_PORT')),
  username: readEnvLocal('DATABASE_PG_USER'),
  password: readEnvLocal('DATABASE_PG_PASS'),
  database: readEnvLocal('DATABASE_PG_NAME'),

  // B0a 子批：实体尚未注册（运行时行为零变化）；接线批次在此补全
  entities: [],

  // 手写迁移目录（与 phase2 第 6 节一致：migration 属于应用部署物，跟 api app 走）
  migrations: ['./apps/api/migrations/*.ts'],

  // 结构演进只经显式命令（migration:run），应用启动不自动跑迁移、更不自动同步
  synchronize: false,
  migrationsRun: false,

  logging: ['error'],
})

import type { DynamicModule, INestApplication, Provider, Type } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as process from 'node:process'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { Test } from '@nestjs/testing'
import { getDataSourceToken } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { createCache } from 'cache-manager'
import { DataSource as TypeOrmDataSource } from 'typeorm'
import { AppModule } from '@/app/app.module'

import { INTEGRATION_DATABASE_NAME } from './integration.const'

/**
 * 集成测试装配辅助：与 `apps/api/test/app.e2e-spec.ts` 同款的全量装配 ——
 * 完整 AppModule（全局模块、guard 链、interceptor 链齐全）。
 *
 * 唯一的替换：CACHE_MANAGER 换成 cache-manager 的内存实现。原因：
 * `CacheConfigService.createCacheOptions` 返回的 `@keyv/redis` store 是 ESM-only 包，
 * 在 vitest 的模块图里会拿到 keyv 的 ESM 构建类，而 CJS 的 `@nestjs/cache-manager`
 * 工厂做 `store instanceof Keyv` 时拿到的是 CJS 构建类 —— 恒为 false，于是把
 * Redis store 再包一层 Keyv，炸在 keyv 的 `_checkIterableAdapter`（双包隐患；
 * vite 侧 inline / alias 都钉不干净——经 vite 转换的模块与 native require 的模块
 * 即使同一物理文件也是不同实例，类身份无法统一）。
 * 本套测试验证的是 Repository 层的 PG 语义，不依赖 Redis 缓存，内存实现即可。
 *
 * @param extraImports 额外追加的模块（如给 PG 侧补 `TypeOrmModule.forFeature` 实体注册）。
 * @param extraProviders 额外追加的 provider（如测试内联的 PG 版仓库子类）。
 * 两者缺省为空，装配与 `app.e2e-spec.ts` 完全一致。
 */
export async function createIntegrationApp(
  extraImports: (DynamicModule | Type)[] = [],
  extraProviders: Provider[] = [],
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraImports],
    providers: extraProviders,
  })
    .overrideProvider(CACHE_MANAGER)
    .useValue(createCache())
    .compile()

  const app = moduleRef.createNestApplication({ logger: false })
  await app.init()

  ensureIntegrationPgDatabase(app)
  await initWalnutPgAdminDataSource(app)

  return app
}

/**
 * 测试专用**管理通道** DataSource（`DATABASE_PG_USER`：superuser / BYPASSRLS）。
 *
 * 数据权限三期把 RLS 缺省改成 `anonymous`（fail-closed），运行时 `walnut_app` 的
 * 池级直连注册表会被拒绝。测试 fixture / 清理属于「运维通道」（与迁移、db:export
 * 同一类），不应该伪装成请求内的 system 通道，因此统一走管理角色连接：
 * - HTTP 请求仍由应用自身以 `walnut_app` 连接（RLS 正常生效）；
 * - fixture/断言用管理连接（天然绕 RLS），不改变被测代码；
 * - RLS 专项测试仍显式用应用连接 + `set_config` 验证拦截。
 *
 * 复用应用 DataSource 的实体元数据（autoLoadEntities 装载的实体不在 options 里），
 * 保证 `manager.insert(Entity, ...)` 这类测试写法可直接用。
 */
const adminDataSources = new WeakMap<INestApplication, DataSource>()

/** 与 globalSetup / data-source.cli 同源：直接读 env-local（不走 process.env，避免 turbo 环境声明耦合） */
function readEnvLocalValue(key: string): string {
  const envPath = resolve(process.cwd(), 'env-local', '.env.development')
  const line = readFileSync(envPath, 'utf-8')
    .split(/\r?\n/)
    .find(l => l.startsWith(`${key}=`))

  if (line === undefined) {
    throw new Error(`[integration] missing ${key} in ${envPath}`)
  }

  return line.slice(key.length + 1).trim()
}

export async function initWalnutPgAdminDataSource(app: INestApplication): Promise<DataSource> {
  const appDataSource = getWalnutPgDataSource(app)
  const adminUser = readEnvLocalValue('DATABASE_PG_USER')
  const adminPass = readEnvLocalValue('DATABASE_PG_PASS')

  const appOptions = appDataSource.options as PostgresDataSourceOptions

  const admin = new TypeOrmDataSource({
    type: 'postgres',
    host: appOptions.host,
    port: appOptions.port,
    database: appOptions.database,
    username: adminUser,
    password: adminPass,
    entities: appDataSource.entityMetadatas.map(meta => meta.target) as never,
    synchronize: false,
    migrations: [],
    logging: ['error'],
  })

  await admin.initialize()

  // fail-fast：管理连接必须指向集成库（与 ensureIntegrationPgDatabase 同口径）
  const [dbRow] = await admin.query<Array<{ db: string }>>('SELECT current_database() AS db')
  if (dbRow?.db !== INTEGRATION_DATABASE_NAME) {
    await admin.destroy()
    throw new Error(`[integration] admin connection points to "${dbRow?.db}", expected "${INTEGRATION_DATABASE_NAME}"`)
  }

  adminDataSources.set(app, admin)

  // 管理连接不在 Nest 生命周期里，挂到 app.close 上统一释放
  const originalClose = app.close.bind(app)
  app.close = async () => {
    await admin.destroy().catch(() => undefined)
    return originalClose()
  }

  return admin
}

/** 测试 fixture/清理用的管理连接（未初始化时抛错，避免静默回退到 app 连接） */
export function getWalnutPgAdminDataSource(app: INestApplication): DataSource {
  const admin = adminDataSources.get(app)
  if (admin === undefined) {
    throw new Error('[integration] admin pg data source not initialized')
  }
  return admin
}

/**
 * PG 命名连接（`WalnutPGConnectionName`，libs/db/src/pg.module.ts）。
 * 事务拦截器与 PG 版仓库骨架的测试都从这取 DataSource。
 */
export function getWalnutPgDataSource(app: INestApplication): DataSource {
  return app.get<DataSource>(getDataSourceToken(WalnutPGConnectionName))
}

/**
 * PG 侧 fail-fast 守卫：运行时 DataSource 的库名必须是集成库。
 * DataSource 的 database 选项即库名（本仓不连到 maintenance 库跑业务查询）。
 */
export function ensureIntegrationPgDatabase(app: INestApplication): void {
  const dataSource = getWalnutPgDataSource(app)

  const dbName = dataSource.options.database as string | undefined
  if (dbName !== INTEGRATION_DATABASE_NAME) {
    throw new Error(
      `[integration] expected pg database "${INTEGRATION_DATABASE_NAME}", got "${dbName}" — refusing to run against anything else`,
    )
  }
}

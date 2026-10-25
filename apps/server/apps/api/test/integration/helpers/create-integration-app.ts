import type { DynamicModule, INestApplication, Provider, Type } from '@nestjs/common'
import type { Connection } from 'mongoose'
import type { DataSource } from 'typeorm'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { getConnectionToken } from '@nestjs/mongoose'
import { Test } from '@nestjs/testing'
import { getDataSourceToken } from '@nestjs/typeorm'
import { WalnutDBConnectionName, WalnutPGConnectionName } from '@walnut-server/db'

import { createCache } from 'cache-manager'
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
 * 本套测试验证的是 Repository 层的 Mongo 语义，不依赖 Redis 缓存，内存实现即可。
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

  ensureIntegrationDatabase(app)
  ensureIntegrationPgDatabase(app)

  return app
}

/**
 * 事务用的 session 必须取自这一个命名连接
 * （`libs/db/src/db.module.ts` 里 `MongooseModule.forRootAsync({ connectionName })` 的那个）。
 * 另开 `mongoose.connect` 拿 session 会报 "session from different cluster"。
 */
export function getWalnutConnection(app: INestApplication): Connection {
  return app.get<Connection>(getConnectionToken(WalnutDBConnectionName))
}

/**
 * PG 命名连接（`WalnutPGConnectionName`，libs/db/src/pg.module.ts）。
 * 双引擎事务与 PG 版仓库骨架的测试都从这取 DataSource。
 */
export function getWalnutPgDataSource(app: INestApplication): DataSource {
  return app.get<DataSource>(getDataSourceToken(WalnutPGConnectionName))
}

/**
 * fail-fast 守卫：断言连的确实是集成库名，不是就立刻红 ——
 * 绝不允许测试流量打到 `walnut-admin-nestjs`（迁移基准数据）。
 * 注：mongoose 的 `Connection#name` 返回的是 dbName，不是 Nest 的连接名；
 * 连接是不是 `WalnutDBConnectionName` 那个命名连接，由 `getConnectionToken` 的取法本身保证。
 */
export function ensureIntegrationDatabase(app: INestApplication): void {
  const connection = getWalnutConnection(app)

  const dbName = connection.name || connection.db?.databaseName
  if (dbName !== INTEGRATION_DATABASE_NAME) {
    throw new Error(
      `[integration] expected dbName "${INTEGRATION_DATABASE_NAME}", got "${dbName}" — refusing to run against anything else`,
    )
  }
}

/**
 * PG 侧同款 fail-fast 守卫：运行时 DataSource 的库名必须是集成库。
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

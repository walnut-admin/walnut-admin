import * as process from 'node:process'
import { defineWalnutVitestConfig } from '@walnut/vitest-config'
import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * 基线集成测试（characterization tests）—— Repository 层现状行为固化，
 * 作为 MongoDB → PostgreSQL 迁移的安全网。
 *
 * 与 unit / e2e 配置的差别：
 * - 只收 `apps/api/test/integration/` 下的 `*.int-spec.ts`，**不进** CI / turbo test / prepush
 *   （CI 没有数据库，这套测试需要本地 Mongo 副本集 + Redis）。
 * - `fileParallelism: false`：多个测试文件共享同一个集成库 `walnut-admin-integration`，
 *   并行 + dropDatabase 会互相打架；串行跑，由 globalSetup 的 teardown 统一 drop。
 * - `setupFiles` 直接写 `process.env`：`libs/config` 的 `config.module.ts` 在模块加载期读
 *   `process.env.NODE_ENV` 决定加载哪个 env 文件（vitest 默认把它设成 `test`，会去找不存在的
 *   `.env.test`），`database.config.ts` 读 `process.env.DATABASE_NAME` 决定 dbName ——
 *   两者都必须赶在 Nest 模块加载前落到 `process.env` 上，不依赖 vitest `test.env` 的注入位置。
 * - `globalSetup` 在跑前先 drop 一次集成库（清掉上次异常退出的残留），跑完再统一 drop。
 * - `TEST_DATA=real` 时 include 收窄到只读 `real-data.api-spec.ts`：real 模式的全量 dump
 *   是给「真实体量断言」用的，既有 500+ 用例的清理前缀假设不适用于 dev 库数据，不能整轮
 *   跑真库。这条同时兜住必跑命令的 `-- real-data` —— Vitest 把 `--` 之后的参数当透传参数，
 *   位置过滤会失效；用 env 收窄 include 才让「单跑 real suite」的意图真正落地。
 *
 * Redis 缓存（CACHE_MANAGER）不在此处处理 —— `@keyv/redis` 是 ESM-only 包，在 vitest 的
 * 模块图里与 CJS 的 `@nestjs/cache-manager` 存在 keyv 双包隐患（`instanceof Keyv` 恒 false，
 * 缓存工厂把 Redis store 再包一层 Keyv 后崩在 `_checkIterableAdapter`），由测试装配辅助
 * `helpers/create-integration-app.ts` 把 CACHE_MANAGER 换成内存实现绕开。
 */
const realDataOnly = process.env.TEST_DATA === 'real'

export default defineWalnutVitestConfig({
  // 集成测试从不跑覆盖率，不产出 coverage 段（同 e2e 口径）
  coverageInclude: false,
  plugins: [swc.vite(), tsconfigPaths()],
  test: {
    // 基线 int-spec（service/repository 层）+ API 级回归 spec（真实 HTTP 全链，
    // helpers/create-api-app 装配）。两类同库共享：fileParallelism:false 串行 +
    // globalSetup 每轮 drop 重建，互相不可见脏数据。
    include: realDataOnly
      ? ['apps/api/test/api/platform/real-data.api-spec.ts']
      : [
          'apps/api/test/integration/**/*.int-spec.ts',
          'apps/api/test/api/**/*.api-spec.ts',
        ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    root: './',
    setupFiles: ['apps/api/test/integration/helpers/setup-env.ts'],
    globalSetup: ['apps/api/test/integration/helpers/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
})

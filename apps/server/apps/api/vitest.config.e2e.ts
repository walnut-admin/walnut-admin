import { defineWalnutVitestConfig } from '@walnut/vitest-config'
import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * e2e 配置（全量 AppModule 真实装配，1 份 spec）。
 *
 * 与 integration 配置共用同一套 env/DB 引导，理由：
 * - vitest 默认把 `NODE_ENV` 设成 `test`，`libs/config` 在模块加载期会去找不存在的
 *   `.env.test`（连带 `DATABASE_PG_APP_USER` 等 RLS 变量缺失直接抛错）。`setupFiles`
 *   在模块加载前把 env 落到 `process.env`（指向集成库，绝不碰 dev 库）；
 * - `globalSetup` 负责集成库的 drop/create/migration（含 undo 可逆验证）+ seed，
 *   e2e 才有一个可用的完整数据库。
 * - `hookTimeout` 放宽：全量 AppModule 装配（DB/Redis/socket）远超默认 10s。
 */
export default defineWalnutVitestConfig({
  // e2e 从不跑覆盖率，不产出 coverage 段
  coverageInclude: false,
  plugins: [swc.vite(), tsconfigPaths()],
  test: {
    include: ['apps/api/test/**/*.e2e-spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    globals: true,
    root: './',
    setupFiles: ['apps/api/test/integration/helpers/setup-env.ts'],
    globalSetup: ['apps/api/test/integration/helpers/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
})

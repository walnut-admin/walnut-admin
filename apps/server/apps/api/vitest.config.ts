import { defineWalnutVitestConfig } from '@walnut/vitest-config'
import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineWalnutVitestConfig({
  // 用例在 apps/api/src 而不是 src —— 覆盖范围要跟着根目录口径走
  coverageInclude: ['apps/api/src'],
  plugins: [
    tsconfigPaths(),
    // This is required to build the test files with SWC
    swc.vite({
      // Explicitly set the module type to avoid inheriting this value from a `.swcrc` config file
      module: { type: 'es6' },
    }),
  ],
  test: {
    root: './',
    globals: true,
    // libs/** 也收：lib 解耦后 co-located 单测随源码进 libs（如 libs/cache 的 appSettings spec）。
    // test/architecture 收的是架构 drift spec —— 它们的被测对象是**整个 server 的结构**，
    // 不是某个模块的行为，因此不住在产品源码里（判据见 architecture-todo 的「测试目录约定」）。
    // 只点这个子目录：同级的 api / integration / e2e 各有自己的配置与后缀口径，不许顺手收进来。
    include: [
      'apps/api/src/**/*.spec.ts',
      'libs/*/src/**/*.spec.ts',
      'apps/api/test/architecture/**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    /**
     * 单条用例的超时放宽到 60 秒（缺省是 5 秒），沿用 `tooling/scripts/vitest.config.ts` 的同一先例。
     *
     * 为什么这个包要单独放宽：架构 drift spec（`test/architecture/**` 与 libs 里的 `*.drift.spec.ts`）
     * 的被测对象是**整个 server 的结构**，要全仓扫描几千个文件。它们平时在 2 秒内跑完，但本机同时跑着
     * 别的会话的重任务时，5 秒缺省会被越过 —— 2026-11-24 一天里就有两条不同的 spec 各假红一次
     * （`core-module-scope.drift.spec.ts` 与 `murlock-isolation.drift.spec.ts`），两次都只红这一条、
     * 单独复跑都通过（均在 2 秒内）。
     * 超时只决定「卡死的用例多久被判死」，不改变正常用例的耗时：真卡住的用例 60 秒后照样红。
     */
    testTimeout: 60_000,
  },
})

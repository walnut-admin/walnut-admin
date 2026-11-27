import { defineWalnutVitestConfig } from '@walnut/vitest-config'

/**
 * `apps/e2e` 的 **vitest** 配置：只收纯函数的 co-located 单测（`lib/` 与 `scripts/` 下的
 * `*.test.ts`；数量会随工具增长，别在这里写死）。
 *
 * 与 Playwright 的分工：
 * - 跨端链路仍由 `playwright test` 跑（`tests/` 下的 `*.spec.ts`，单 worker、真实浏览器）；
 * - 这里是**不需要浏览器 / 数据库**的纯函数验证（脱敏规则），秒级、可进 `turbo test`。
 *
 * `include` 刻意只点 `*.test.ts`：Playwright 的 spec 后缀是 `*.spec.ts`，两套发现规则
 * 物理分开 —— 谁也不会把对方的文件当自己的用例收走。
 */
export default defineWalnutVitestConfig({
  // 纯函数单测没有覆盖率口径（也不产出 coverage 段，与 apps/server 的 e2e 配置同口径）
  coverageInclude: false,
  test: {
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist*/**', 'test-results/**', 'playwright-report/**'],
  },
})

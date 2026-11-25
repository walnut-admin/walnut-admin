/**
 * Playwright 的 test 扩展：**设备自动清理**（P1-2）。
 *
 * 为什么必须是 fixture：断言失败会跳过用例末尾的手写 `cleanupDevices(...)` —— 失败越多、
 * 留下的设备行与 Redis 键越多，下一轮的读数就被上一轮的残渣污染（而这一层要看真话）。
 * fixture 的 teardown 在用例失败后照样执行。
 *
 * 收集方式：设备由 `lib/device-fixtures.ts` 的 `trackDevice` 登记（工厂函数自动登记；手写签发的
 * 设备由用例自己登记）。两个作用域各管一段：
 *
 * - **test 作用域（auto）**：每条用例结束清一次 —— 失败的那条也不留残渣，清理失败的 id
 *   留给下面那层再试；
 * - **worker 作用域（auto）**：本 project 的 worker 退出时再清一次兜底。
 *   Playwright 每个 project 一个 worker 进程，所以实际粒度是「每个 project 一次」。
 *
 * 两个作用域都**不抛错**：清理失败只 `console.warn`（test 作用域还会 attach 到 testInfo），
 * 绝不让收尾动作掩盖真正的断言失败。
 */
import type { TestInfo } from '@playwright/test'
import { test as base } from '@playwright/test'
import { flushTrackedDevices } from '../lib/device-fixtures.ts'

export { expect } from '@playwright/test'

export const test = base.extend<{ deviceCleanup: void }, { deviceCleanupRun: void }>({
  // Playwright 的 fixture 回调首参是「本 fixture 依赖的其它 fixture」映射；这两条不依赖任何
  // fixture（也不该依赖：test 作用域要是写上 `page`，每条用例都会被强制开一个页面）。
  // eslint-disable-next-line no-empty-pattern -- 空映射是 Playwright 的签名，不是笔误
  deviceCleanupRun: [async ({}, use) => {
    await use()
    await flushTrackedDevices()
  }, { scope: 'worker', auto: true }],

  // eslint-disable-next-line no-empty-pattern -- 同上
  deviceCleanup: [async ({}, use, testInfo: TestInfo) => {
    await use()
    await flushTrackedDevices({ testInfo })
  }, { auto: true }],
})

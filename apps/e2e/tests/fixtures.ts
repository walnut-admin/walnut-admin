/**
 * Playwright 的 test 扩展：**设备自动清理**（P1-2）与 **worker 级共享只读登录 context**（P0-3）。
 *
 * 为什么清理必须是 fixture：断言失败会跳过用例末尾的手写 `cleanupDevices(...)` —— 失败越多，
 * 留下的设备行与 Redis 键越多，下一轮的读数就被上一轮的残渣污染（而这一层要看真话）。
 * fixture 的 teardown 在用例失败后照样执行。
 *
 * 收集方式：设备由 `lib/device-fixtures.ts` 的 `trackDevice` 登记（工厂函数自动登记；手写签发的
 * 设备由用例自己登记）。作用域分三层：
 *
 * - **test 作用域（auto）**：每条用例结束清一次 —— 失败的那条也不留残渣，清理失败的 id
 *   留给下面那层再试；
 * - **worker 作用域（auto）**：本 project 的 worker 退出时再清一次兜底。
 *   Playwright 每个 project 一个 worker 进程，所以实际粒度是「每个 project 一次」；
 * - **worker 作用域共享设备**（`trackWorkerDevice`）：只给 `authedContext` 用，它在多条用例间
 *   存活，不能在某条用例结束时被上面那层顺手删掉。
 *
 * 两层清理都**不抛错**：失败只 `console.warn`（test 作用域还会 attach 到 testInfo），
 * 绝不让收尾动作掩盖真正的断言失败。
 */
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import { test as base } from '@playwright/test'
import {
  flushTrackedDevices,
  flushWorkerTrackedDevices,
  newBrowserContext,
  resolveDeviceId,
  trackWorkerDevice,
} from '../lib/device-fixtures.ts'
import { loginViaUI } from '../lib/ui.ts'

export { expect } from '@playwright/test'

export const test = base.extend<
  { deviceCleanup: void, authedPage: Page },
  { deviceCleanupRun: void, authedContext: BrowserContext }
>({
  // Playwright 的 fixture 回调首参是「本 fixture 依赖的其它 fixture」映射；这两条不依赖任何
  // fixture（也不该依赖：test 作用域要是写上 `page`，每条用例都会被强制开一个页面）。
  // eslint-disable-next-line no-empty-pattern -- 空映射是 Playwright 的签名，不是笔误
  deviceCleanupRun: [async ({}, use) => {
    await use()
    await flushTrackedDevices()
    await flushWorkerTrackedDevices()
  }, { scope: 'worker', auto: true }],

  // eslint-disable-next-line no-empty-pattern -- 同上
  deviceCleanup: [async ({}, use, testInfo: TestInfo) => {
    await use()
    await flushTrackedDevices({ testInfo })
  }, { auto: true }],

  /**
   * worker 级共享的**只读**已登录 context：worker 启动时走一次完整 UI 登录，之后同一 worker
   * 的只读用例直接复用它（`authedPage` 每次从它开一个新页面）。
   *
   * 为什么这不是 storageState 复用（不变量 7 仍然成立）：
   * - **不落盘、不跨进程**：登录态只活在这个 worker 的浏览器 context 内存里（IndexedDB 的
   *   AES `CryptoKey` 也在），进程退出即消失；没有写任何 storageState 文件，也没有在
   *   project 上挂 `storageState`。
   * - 它只服务于**只读**用例（无写操作、无「全新设备」语义）；有写操作或需要新设备身份的
   *   用例必须自己开 context（`lib/device-fixtures.ts` 的 `openDevice` / `loginDevice`）。
   * - 这台设备登记为 **worker 作用域**（`trackWorkerDevice`），由 worker 级 auto fixture
   *   在进程退出时清理 —— 不会被某条用例的 test 作用域清理提前删掉。
   */
  authedContext: [async ({ browser }, use) => {
    const context = await newBrowserContext(browser)
    const page = await context.newPage()
    await loginViaUI(page)
    trackWorkerDevice(await resolveDeviceId(page))
    // 登录页关闭后登录态仍留在 context（cookies + localStorage + IndexedDB）里
    await page.close()
    await use(context)
    await context.close()
  }, { scope: 'worker' }],

  /** 共享已登录 context 里的新页面（每个只读用例一份，避免上一用例的页面状态串过来） */
  authedPage: async ({ authedContext }, use) => {
    const page = await authedContext.newPage()
    await use(page)
    await page.close()
  },
})

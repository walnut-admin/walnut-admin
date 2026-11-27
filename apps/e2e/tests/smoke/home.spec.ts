/**
 * 冒烟 ②：登录态下的首页 —— 侧边栏渲染、页面标题、一条真实的已登录请求（业务码 20000）。
 *
 * 登录态来自 **worker 级共享只读 context**（`tests/fixtures.ts` 的 `authedPage`）：worker 启动时
 * 走一次完整 UI 登录，本用例不再自己登录。这是同一 worker 进程内的内存复用，
 * 不落盘、不跨进程、不在 project 上挂 storageState（不变量 7）；共享 context 只挂只读用例。
 */
import { AuthRoutes, WalnutAdminConstAppResponseCode } from '../../lib/protocol/contract.ts'
import {
  captureEnvelopes,
  expectSidebarRendered,
  readDeviceCookie,
  SIDEBAR_MENU_ITEM_SELECTOR,
  waitForEnvelope,
} from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'

test('首页：侧边栏 / 标题 / 已登录请求 20000', { tag: '@smoke' }, async ({ authedPage }) => {
  const captured = captureEnvelopes(authedPage)
  // 新页面从共享 context 的登录态启动：重新进首页会重放登录后的 permissions 请求
  await authedPage.goto('/')
  await expectSidebarRendered(authedPage)

  const menuItems = authedPage.locator(SIDEBAR_MENU_ITEM_SELECTOR)
  expect(await menuItems.count(), '侧边栏一个菜单项都没有（menus 来自 /auth/permissions）').toBeGreaterThan(0)

  // 标题由 useAppTitle 拼：`<当前路由 title> - <VITE_APP_TITLE>`
  await expect(authedPage).toHaveTitle(/ - Walnut Admin$/)

  // 已登录请求的硬证据：permissions 返回 20000（不是 HTTP 200 —— 业务错误也是 200）
  const permissions = await waitForEnvelope(
    captured.entries,
    entry => entry.url.includes(AuthRoutes.PERMISSIONS) && entry.code === WalnutAdminConstAppResponseCode.SUCCESS,
    40_000,
  )
  expect(permissions.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

  // 登录态下 DEVICE_ID 必须在（设备身份是每个受保护请求的前置）
  const cookie = await readDeviceCookie(authedPage.context())
  expect(cookie, '首页加载后应持有 DEVICE_ID cookie').not.toBeNull()

  captured.stop()
})

/**
 * 冒烟 ②：登录态下的首页 —— 侧边栏渲染、页面标题、一条真实的已登录请求（业务码 20000）。
 *
 * 登录态**每条用例自己造**：storageState 复用已判死（IndexedDB 里的 AES CryptoKey 恢复不了，
 * 见 playwright.config.ts），所以这里从干净 context 走完整 UI 登录。
 */
import {
  installRealIpRoute,
  resolveDeviceId,
  trackDevice,
  uniqueLocalIp,
} from '../../lib/device-fixtures.ts'
import {
  captureEnvelopes,
  ensureLoggedIn,
  expectSidebarRendered,
  readDeviceCookie,
  waitForEnvelope,
} from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'

test('首页：侧边栏 / 标题 / 已登录请求 20000', async ({ page }) => {
  // device/initial 的 throttle 是 4 次/60s per realIp：每条用例一份独立 local IP
  await installRealIpRoute(page.context(), uniqueLocalIp())
  const captured = captureEnvelopes(page)

  await ensureLoggedIn(page)
  // 立刻登记：后面的断言失败时，清理 fixture 仍要能找到这台设备
  trackDevice(await resolveDeviceId(page))
  await expectSidebarRendered(page)

  const menuItems = page.locator('.w-menu .w-menu-item-content')
  expect(await menuItems.count(), '侧边栏一个菜单项都没有（menus 来自 /auth/permissions）').toBeGreaterThan(0)

  // 标题由 useAppTitle 拼：`<当前路由 title> - <VITE_APP_TITLE>`
  await expect(page).toHaveTitle(/ - Walnut Admin$/)

  // 已登录请求的硬证据：permissions 返回 20000（不是 HTTP 200 —— 业务错误也是 200）
  const permissions = await waitForEnvelope(
    captured.entries,
    entry => entry.url.includes('/auth/permissions') && entry.code === 20000,
    40_000,
  )
  expect(permissions.code).toBe(20000)

  // 登录态下 DEVICE_ID 必须在（设备身份是每个受保护请求的前置）
  const cookie = await readDeviceCookie(page.context())
  expect(cookie, '首页加载后应持有 DEVICE_ID cookie').not.toBeNull()

  captured.stop()
  // 设备清理由 tests/fixtures.ts 的 auto fixture 负责（断言失败时也执行）
})

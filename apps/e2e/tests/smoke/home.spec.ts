/**
 * 冒烟 ②：登录态下的首页 —— 侧边栏渲染、页面标题、一条真实的已登录请求（业务码 20000）。
 *
 * 登录态来自 auth-setup 的 storageState；**复用失败时 `ensureLoggedIn` 会自动走 UI 登录**
 * （Phase 0 gate 2 的两种结论下这条用例都成立，区别只在耗时）。
 */
import { expect, test } from '@playwright/test'
import { cleanupDevices, installRealIpRoute, resolveDeviceId, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { captureEnvelopes, ensureLoggedIn, expectSidebarRendered, readDeviceCookie, waitForEnvelope } from '../../lib/ui.ts'

test('首页：侧边栏 / 标题 / 已登录请求 20000', async ({ page }) => {
  // device/initial 的 throttle 是 4 次/60s per realIp：每条用例一份独立 local IP
  await installRealIpRoute(page.context(), uniqueLocalIp())
  const captured = captureEnvelopes(page)

  // 返回 null = 复用了 auth-setup 的设备；非 null = 本用例自己 UI 登录出来的新设备
  const ownLogin = await ensureLoggedIn(page)
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

  // 自清理：只删本用例自己造的设备（复用 auth-setup 的设备时不删）
  if (ownLogin !== null) {
    await cleanupDevices([await resolveDeviceId(page)])
  }
})

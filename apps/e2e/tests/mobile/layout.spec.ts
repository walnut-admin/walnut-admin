/**
 * 设备 profile 矩阵的**起步规模**：1 个 mobile（Pixel 7）布局用例。
 *
 * 为什么只有这一条（计划页 Phase 3 第 3 项的判据）：
 * - 本仓的设备身份是**服务端签发的 DEVICE_ID signed cookie**，不消费浏览器指纹 —— 把
 *   设备生命周期 / risk 用例在 mobile 上重跑一遍只是同一条逻辑多跑几遍，抓不到新缺陷；
 * - mobile profile 真正独有的面是**响应式布局**：桌面 1600×900 的 context 覆盖（
 *   `lib/device-fixtures.ts` 的 `newBrowserContext`）天生看不到它，所以用 project 级
 *   `devices['Pixel 7']` + 浏览器内几何量断言，而不是复制业务用例。
 *
 * 刻意**不登录**（秒级、确定性）：登录链路的业务正确性已由 smoke / risk 覆盖；这里只证明
 * 「移动端 device 描述符真的生效 + 登录入口在 375–430px 视口内不溢出」。
 *
 * 设备登记仍走真实链路（`page.goto` → `POST /system/device/initial`），XFF 用
 * `installRealIpRoute` 注入（不变量 2：只加在同源 `/api/` 请求上），设备登记给清理 fixture。
 */
import { expect, test } from '@playwright/test'
import { installRealIpRoute, trackDevice, uniqueLocalIp, waitForRegisteredDevice } from '../../lib/device-fixtures.ts'
import { LOGIN_USERNAME_SELECTOR } from '../../lib/ui.ts'

test('mobile（Pixel 7）：登录页不横向溢出、设备登记成功、移动 UA 生效', { tag: '@mobile' }, async ({ page }) => {
  await installRealIpRoute(page.context(), uniqueLocalIp())

  await page.goto('/auth')
  await expect(page.locator(LOGIN_USERNAME_SELECTOR).first()).toBeVisible()

  // 1. 设备 descriptor 真的生效（不是静默回落到桌面 context）
  const ua = await page.evaluate(() => navigator.userAgent)
  expect(ua, 'project 的 Pixel 7 UA 没有生效').toContain('Mobile')
  expect(ua, 'project 的 Pixel 7 UA 没有生效').toContain('Android')

  // 2. 设备登记仍走真实链路（localStorage 里是服务端签发的 d1_ id）
  const deviceId = await waitForRegisteredDevice(page)
  expect(deviceId).toMatch(/^d1_[0-9a-f]{32}$/)
  trackDevice(deviceId)

  // 3. 移动视口 + 无横向溢出（登录表单的右边界也在视口内）
  const geometry = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(geometry.innerWidth, 'viewport 不是移动端宽度').toBeLessThan(500)
  expect(geometry.scrollWidth, '登录页在移动端出现横向溢出').toBeLessThanOrEqual(geometry.innerWidth + 1)

  const formBox = await page.locator(LOGIN_USERNAME_SELECTOR).first().boundingBox()
  expect(formBox, '登录用户名输入框没有渲染出可测的 box').not.toBeNull()
  expect(formBox!.x, '登录表单左边界越出视口').toBeGreaterThanOrEqual(0)
  expect(formBox!.x + formBox!.width, '登录表单右边界越出视口').toBeLessThanOrEqual(geometry.innerWidth + 1)
})

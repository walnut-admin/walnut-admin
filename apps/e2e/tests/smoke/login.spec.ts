/**
 * 冒烟 ①：**干净 context 的 UI 登录**（Phase 0 gate 1 / 3 / 6 的那条路径）。
 *
 * 刻意覆盖 project 的 storageState 为空：这条用例要证明「从零开始」也能登进来 ——
 * 包括新设备必过的 CAP（cap-widget + jsDelivr WASM）与 MFA 验证页。
 */
import { expect, test } from '@playwright/test'
import { cleanupDevices, installRealIpRoute, resolveDeviceId, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { findDeviceRow, LOOPBACK_IP_PATTERN, withPg } from '../../lib/pg.ts'
import {
  captureEnvelopes,
  expectSidebarRendered,
  loginViaUI,
  readDeviceCookie,
  readLocalDeviceId,
  waitForEnvelope,
} from '../../lib/ui.ts'

test.use({ storageState: { cookies: [], origins: [] } })

test('登录：CAP + TOTP MFA 全过，落 DEVICE_ID cookie 并进首页', async ({ page }) => {
  // device/initial 的 throttle 是 4 次/60s per realIp：每条用例一份独立 local IP
  await installRealIpRoute(page.context(), uniqueLocalIp())
  const captured = captureEnvelopes(page)
  const login = await loginViaUI(page)

  expect(login.capSolved, '新设备登录应出现 cap-widget 并解出').toBe(true)
  expect(login.mfaVerified, '新设备登录应经过 /mfa-verified').toBe(true)

  // 业务码证据：设备登记 20000 + 登录成功（login/finish 之后会有 profile/permissions 20000）
  await waitForEnvelope(captured.entries, entry => entry.url.includes('/system/device/initial') && entry.code === 20000)
  await waitForEnvelope(captured.entries, entry => entry.url.includes('/auth/permissions') && entry.code === 20000, 40_000)
  captured.stop()

  // DEVICE_ID cookie：stage 形态无前缀；值带 `s:` 签名；形态 d1_ + 32 hex
  const cookie = await readDeviceCookie(page.context())
  expect(cookie).not.toBeNull()
  const cookieDeviceId = decodeURIComponent(cookie!.value).startsWith('s:')
    ? decodeURIComponent(cookie!.value).slice(2).split('.')[0] ?? ''
    : decodeURIComponent(cookie!.value).split('.')[0] ?? ''
  expect(cookieDeviceId).toMatch(/^d1_[0-9a-f]{32}$/)

  // localStorage 与 cookie 同源（前端自愈链路的判据）
  expect(await readLocalDeviceId(page)).toBe(cookieDeviceId)

  // 库里有行：新设备、本地 IP、active
  await withPg(async (pg) => {
    const row = await findDeviceRow(pg, cookieDeviceId)
    expect(row, `sys_device 缺 ${cookieDeviceId}`).not.toBeNull()
    expect(row!.ip).toMatch(LOOPBACK_IP_PATTERN)
    expect(row!.active).toBe(true)
    expect(row!.banned).toBe(false)
    expect(row!.locked).toBe(false)
  })

  // 已进应用外壳
  expect(page.url()).not.toContain('/auth')
  await expectSidebarRendered(page)

  // 自清理：本用例造的设备（auth-setup 的设备是另一台，不动）
  const deviceId = await resolveDeviceId(page)
  await cleanupDevices([deviceId])
})

/**
 * auth-setup：**UI 登录**（填表 → CAP → MFA）的门禁断言，并把实测结论写进
 * `.auth/gate-report.json`：
 * - `--admin` 的凭据能过完整 UI 登录（identifiers 对齐）；
 * - 新设备登记 `device/initial` 与登录后的 `/auth/permissions` 都是 20000；
 * - stage 形态的无前缀 `DEVICE_ID` + Secure cookie 能落在 `http://127.0.0.1` 上；
 * - 库里的设备行是 active / 未封禁 / 未锁定。
 *
 * 原 `tests/smoke/login.spec.ts` 已并入这里（P0-3 登录瘦身）：两份断言高度重叠，
 * 合并后 smoke 只做一次「全新设备」的完整 UI 登录，不再为登录路径重复登录一次。
 *
 * 它**不产出可复用的登录态**：`storageState({indexedDB:true})` 恢复不了 IndexedDB 里的 AES
 * `CryptoKey`，Phase 0 的 gate 2 已判死（P2-14）—— 探针与写盘都删了，结论以固定的
 * `not-reusable` 记在报告里，不再每轮实测。smoke 的只读用例复用 worker 内存里的登录 context
 * （`tests/fixtures.ts` 的 `authedPage`），仍然不落盘、不跨进程。
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { installRealIpRoute, resolveDeviceId, trackDevice, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { findDeviceRow, LOOPBACK_IP_PATTERN, withPg } from '../../lib/pg.ts'
import { AuthRoutes, SystemEndpointRoutes, WalnutAdminConstAppResponseCode } from '../../lib/protocol/contract.ts'
import {
  captureEnvelopes,
  expectSidebarRendered,
  loginViaUI,
  readDeviceCookie,
  readLocalDeviceId,
  waitForEnvelope,
} from '../../lib/ui.ts'
import { AUTH_DIR, DEVICE_COOKIE_NAME } from '../../scripts/env.ts'
import { test } from '../fixtures.ts'

const GATE_REPORT_FILE = path.join(AUTH_DIR, 'gate-report.json')

// 与已删除的 login.spec 同口径：显式声明干净 context（project 本来也不挂 storageState）
test.use({ storageState: { cookies: [], origins: [] } })

test('auth：UI 登录（CAP + MFA）并核对设备登记 / cookie / 库行', async ({ page }) => {
  // device/initial 的 throttle 是 4 次/60s per realIp：这条完整登录用一份独立 local IP
  await installRealIpRoute(page.context(), uniqueLocalIp())
  const captured = captureEnvelopes(page)
  const login = await loginViaUI(page)
  // 立刻登记：后面的断言失败时，清理 fixture 仍要能找到这台设备
  trackDevice(await resolveDeviceId(page))

  // Phase 0 gate 1：--admin 的凭据能过 UI 登录（identifiers 对齐）
  expect(login.url, '登录后应离开 /auth 与 /mfa-verified').not.toContain('/auth')
  expect(login.url).not.toContain('/mfa-verified')
  await expectSidebarRendered(page)

  // Phase 0 gate 6：新设备必然触发 CAP（DEVICE_NEW critical）——没解出就登不进来
  expect(login.capSolved, '全新设备登录应出现并解出 cap-widget（WASM 自托管、同源加载）').toBe(true)
  // 新浏览器设备没有 MFA 的 trusted 缓存 ⇒ 必须过验证页
  expect(login.mfaVerified, '新设备登录应经过 /mfa-verified（TOTP）').toBe(true)

  // 业务码证据（原 login.spec）：设备登记 20000 + 登录后的 permissions 20000
  await waitForEnvelope(captured.entries, entry => entry.url.includes(SystemEndpointRoutes.DEVICE_INITIAL) && entry.code === WalnutAdminConstAppResponseCode.SUCCESS)
  await waitForEnvelope(captured.entries, entry => entry.url.includes(AuthRoutes.PERMISSIONS) && entry.code === WalnutAdminConstAppResponseCode.SUCCESS, 40_000)
  captured.stop()

  // Phase 0 gate 3：stage 形态的无前缀 DEVICE_ID + Secure cookie 能否落在 http://127.0.0.1
  const cookie = await readDeviceCookie(page.context())
  expect(cookie, `${DEVICE_COOKIE_NAME} cookie 没有落盘（Chrome 拒收 Secure cookie？）`).not.toBeNull()
  expect(cookie!.secure, 'stage 的 cookie 是 Secure（F-43 收紧后）').toBe(true)
  expect(cookie!.httpOnly).toBe(true)
  expect(cookie!.path).toBe('/')

  // cookie 里的设备 id 与 localStorage 的必须同一个（value 带 `s:` 签名前缀）
  const cookieDeviceId = decodeURIComponent(cookie!.value).split('.')[0]?.replace(/^s:/, '')
  const localDeviceId = await readLocalDeviceId(page)
  if (localDeviceId === null) {
    throw new Error('[e2e/auth-setup] localStorage 里没有设备 id')
  }
  expect(cookieDeviceId, 'cookie 与 localStorage 的设备 id 不一致').toBe(localDeviceId)
  expect(localDeviceId).toMatch(/^d1_[0-9a-f]{32}$/)

  // 库里有行：新设备、本地 IP、active / 未封禁 / 未锁定（原 login.spec 的 PG 断言）
  await withPg(async (pg) => {
    const row = await findDeviceRow(pg, localDeviceId)
    expect(row, `sys_device 缺 ${localDeviceId}`).not.toBeNull()
    expect(row!.ip).toMatch(LOOPBACK_IP_PATTERN)
    expect(row!.active).toBe(true)
    expect(row!.banned).toBe(false)
    expect(row!.locked).toBe(false)
  })

  writeFileSync(
    GATE_REPORT_FILE,
    `${JSON.stringify({
      measuredAt: new Date().toISOString(),
      uiLogin: { capSolved: login.capSolved, mfaVerified: login.mfaVerified, landing: login.url },
      deviceCookie: { name: DEVICE_COOKIE_NAME, secure: cookie!.secure, httpOnly: cookie!.httpOnly, path: cookie!.path },
      storageStateReuse: {
        decision: 'not-reusable',
        reason: 'storageState({indexedDB:true}) 不能恢复 IndexedDB 里的 AES CryptoKey（Phase 0 gate 2 判死）',
      },
    }, null, 2)}\n`,
    'utf8',
  )

  console.log('[e2e/auth-setup] UI 登录门禁通过；storageState 复用已判死（不产出可复用登录态）')
})

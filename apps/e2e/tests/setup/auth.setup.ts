/**
 * auth-setup：**UI 登录**（填表 → CAP → MFA）的门禁断言，并把两件事的实测结论写进
 * `.auth/gate-report.json`：
 * - `--admin` 的凭据能过完整 UI 登录（identifiers 对齐）；
 * - stage 形态的无前缀 `DEVICE_ID` + Secure cookie 能落在 `http://127.0.0.1` 上。
 *
 * 它**不产出可复用的登录态**：`storageState({indexedDB:true})` 恢复不了 IndexedDB 里的 AES
 * `CryptoKey`，Phase 0 的 gate 2 已判死（P2-14）—— 探针与写盘都删了，结论以固定的
 * `not-reusable` 记在报告里，不再每轮实测。smoke 用例因此每条自己走 UI 登录。
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { trackDevice } from '../../lib/device-fixtures.ts'
import { expectSidebarRendered, loginViaUI, readDeviceCookie, readLocalDeviceId } from '../../lib/ui.ts'
import { AUTH_DIR, DEVICE_COOKIE_NAME } from '../../scripts/env.ts'
import { test } from '../fixtures.ts'

const GATE_REPORT_FILE = path.join(AUTH_DIR, 'gate-report.json')

test('auth：UI 登录（CAP + MFA）并核对设备 cookie', async ({ page }) => {
  const login = await loginViaUI(page)

  // Phase 0 gate 1：--admin 的凭据能过 UI 登录（identifiers 对齐）
  expect(login.url, '登录后应离开 /auth 与 /mfa-verified').not.toContain('/auth')
  expect(login.url).not.toContain('/mfa-verified')
  await expectSidebarRendered(page)

  // Phase 0 gate 6：新设备必然触发 CAP（DEVICE_NEW critical）——没解出就登不进来
  expect(login.capSolved, '全新设备登录应出现并解出 cap-widget（jsDelivr WASM）').toBe(true)
  // 新浏览器设备没有 MFA 的 trusted 缓存 ⇒ 必须过验证页
  expect(login.mfaVerified, '新设备登录应经过 /mfa-verified（TOTP）').toBe(true)

  // Phase 0 gate 3：stage 形态的无前缀 DEVICE_ID + Secure cookie 能否落在 http://127.0.0.1
  const cookie = await readDeviceCookie(page.context())
  expect(cookie, `${DEVICE_COOKIE_NAME} cookie 没有落盘（Chrome 拒收 Secure cookie？）`).not.toBeNull()
  expect(cookie!.secure, 'stage 的 cookie 是 Secure（F-43 收紧后）').toBe(true)
  expect(cookie!.httpOnly).toBe(true)
  expect(cookie!.path).toBe('/')

  // cookie 里的设备 id 与 localStorage 的必须同一个（value 带 `s:` 签名前缀）
  const cookieDeviceId = decodeURIComponent(cookie!.value).split('.')[0]?.replace(/^s:/, '')
  const localDeviceId = await readLocalDeviceId(page)
  expect(cookieDeviceId, 'cookie 与 localStorage 的设备 id 不一致').toBe(localDeviceId)
  expect(localDeviceId).toMatch(/^d1_[0-9a-f]{32}$/)

  // 本用例签发的设备交给清理 fixture（断言失败时也要清掉）
  trackDevice(localDeviceId)

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

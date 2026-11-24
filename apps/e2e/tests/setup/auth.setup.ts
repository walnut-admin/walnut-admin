/**
 * auth-setup：**UI 登录**（填表 → CAP → MFA）→ 落 storageState，并顺手把 Phase 0 的
 * 「登录态能不能复用」「Secure cookie 在 http://127.0.0.1 是否被接受」两项量出来。
 *
 * 为什么复用要在这里测：Playwright 的 `storageState({ indexedDB: true })` 能否把
 * AES CryptoKey（IndexedDB 里的结构化克隆对象）搬进新 context，只有新 context 打开站点
 * **试一次**才知道。结论写进 `.auth/gate-report.json`；smoke 用例本身不依赖它
 * （`ensureLoggedIn` 兜底：复用成功就直接进内页，失败就走完整 UI 登录）。
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { expectSidebarRendered, loginViaUI, readDeviceCookie, readLocalDeviceId } from '../../lib/ui.ts'
import {
  AUTH_DIR,
  DEVICE_COOKIE_NAME,
  STORAGE_STATE_FILE,
  WEB_ORIGIN,
} from '../../scripts/env.ts'

const GATE_REPORT_FILE = path.join(AUTH_DIR, 'gate-report.json')

test('auth：UI 登录（CAP + MFA）并落 storageState', async ({ page }) => {
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

  await page.context().storageState({ path: STORAGE_STATE_FILE, indexedDB: true })

  // Phase 0 gate 2：新 context 复用 storageState（IndexedDB 里的 CryptoKey 是否活着）
  const probe = await page.context().browser()!.newContext({ storageState: STORAGE_STATE_FILE })
  const probePage = await probe.newPage()
  let reuse = 'failed'
  let landing = ''
  try {
    await probePage.goto(WEB_ORIGIN)
    const outcome = await Promise.race([
      probePage.locator('.w-menu').first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'reused' as const),
      probePage.locator('input[autocomplete="username"]').waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'needs-login' as const),
    ]).catch(() => 'timeout' as const)
    reuse = outcome === 'reused' ? 'reused' : 'failed'
    landing = probePage.url()
  }
  finally {
    await probe.close()
  }

  writeFileSync(
    GATE_REPORT_FILE,
    `${JSON.stringify({
      measuredAt: new Date().toISOString(),
      uiLogin: { capSolved: login.capSolved, mfaVerified: login.mfaVerified, landing: login.url },
      deviceCookie: { name: DEVICE_COOKIE_NAME, secure: cookie!.secure, httpOnly: cookie!.httpOnly, path: cookie!.path },
      storageStateReuse: { result: reuse, probeLanding: landing },
    }, null, 2)}\n`,
    'utf8',
  )

  // 复用失败**不算** setup 失败（用例有 ensureLoggedIn 兜底；gate 的结论在报告里）。
  // 但这里必须留痕：报告是 Phase 0 的唯一实测证据。
  console.log(`[e2e/auth-setup] storageState(indexedDB) 复用结果=${reuse}，落点=${landing}`)
})

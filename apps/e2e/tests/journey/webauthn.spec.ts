import type { CDPSession, Page } from '@playwright/test'
import type { LoginableUser } from '../../lib/account-fixtures.ts'
import { deleteLoginableUser } from '../../lib/account-fixtures.ts'
import { openDevice } from '../../lib/device-fixtures.ts'
import { findWebauthnMfaRow, readUserMfaSetup, withPg } from '../../lib/pg.ts'
import { AuthRoutes, SystemEndpointRoutes, WalnutAdminConstAppResponseCode } from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { captureEnvelopes, describeFailureContext, LOGIN_PASSWORD_SELECTOR, LOGIN_USERNAME_SELECTOR, markAppIntroSeen, solveCapWidget } from '../../lib/ui.ts'
import { WEBAUTHN_WEB_ORIGIN } from '../../scripts/env.ts'
import { expect, test } from '../fixtures.ts'
import { createJourneyUser } from './journey-support.ts'

/**
 * J6 WebAuthn 正向闭环：虚拟认证器注册 → 用同一凭据完成登录 ceremony。
 *
 * 为什么必须是 E2E：api-spec 明确登记「webauthn 正向 register/verify + authenticate/verify
 * 需要浏览器凭证，不进回归」（`ENDPOINTS_TESTING`/`ENDPOINTS.md` 的裁决）—— 只有真实
 * `navigator.credentials` + 真实断言签名能证明这条链。
 *
 * 浏览器侧口径（实测钉住的两点）：
 * - **RP ID 必须是 hostname**：Chrome 对 `127.0.0.1` 直接抛
 *   `SecurityError: 127.0.0.1 is an invalid domain`，所以本用例的 context 跑在
 *   `http://localhost:<webPort>`（`WEBAUTHN_WEB_ORIGIN`），后端以
 *   `AUTH_WEBAUTHN_RPID=localhost` / `AUTH_WEBAUTHN_ORIGIN=<同一 origin>` 启动
 *   （`scripts/env.ts` 的 backendEnvOverrides —— 部署机公网 origin 在这里必然不匹配）。
 * - **CDP 虚拟认证器**：`WebAuthn.enable` + `addVirtualAuthenticator`（ctap2 / internal /
 *   residentKey + userVerification + 自动确认），凭据存在虚拟认证器里；注册与登录 ceremony
 *   用**同一个 page / 同一条 CDP session**（换 context 会换掉认证器实例）。
 *
 * 服务端真源：`SysUserMfaWebauthnService`（challenge 存 Redis `AUTH:MFA:WEBAUTN:<user>:<device>:<type>`，
 * 5 分钟；register/verify 校验 origin/rpId 后加密公钥落 `sys_user_mfa`；authenticate/verify
 * 校验签名与 counter、更新 last_used_at、再走 MFA post-verification 轮换 AT/RT）。
 *
 * 旅程全程走**真实 UI**（新用户登录 → `/mfa-required` 强制绑定 → `/mfa-verified` 用 WebAuthn
 * 验证），协议只用于造号（设初始口令）与 PG 断言。
 */

interface ServerEnvelope<T = Record<string, unknown>> {
  code: number
  data: T
  msg?: string
}

/** 虚拟认证器的凭据（CDP `WebAuthn.getCredentials` 出参的子集） */
interface VirtualCredential {
  credentialId: string
  rpId: string
  signCount: number
  isResidentCredential: boolean
}

async function addVirtualAuthenticator(page: Page): Promise<{ cdp: CDPSession, authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      // 服务端 register/options 要求 residentKey=preferred + userVerification=preferred；
      // 虚拟认证器把两者都打开（isUserVerified=true 让自动确认等价于「用户在场」）。
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { cdp, authenticatorId }
}

async function readCredentials(cdp: CDPSession, authenticatorId: string): Promise<VirtualCredential[]> {
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId }) as { credentials: VirtualCredential[] }
  return credentials
}

/**
 * base64 → base64url（无 padding）。
 *
 * CDP 的 `WebAuthn.getCredentials` 返回标准 base64（`+` `/` `=`），而 simplewebauthn 校验后
 * 落库的 `credential.id` 是 base64url —— 不换算就会拿两种编码比同一个字节串。
 */
function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * 密码登录到 MFA 页（不处理 MFA 本身）：CAP 两次（启动 + 提交后）→ 等 `/mfa-required`
 * 或 `/mfa-verified`。`expected` 由调用方声明 —— 走错页面是「账号 MFA 状态与预期不符」，
 * 要在这一步说清，而不是后面点不到卡片。
 */
async function loginUntilMfaPage(page: Page, user: LoginableUser, expected: '/mfa-required' | '/mfa-verified'): Promise<void> {
  await page.goto('/auth')
  // 之后会进 default layout（driver.js 全屏引导无法关闭）—— 与 loginViaUI 同口径预置
  await markAppIntroSeen(page)

  await solveCapWidget(page, { appearTimeoutMs: 6_000 })
  const userName = page.locator(LOGIN_USERNAME_SELECTOR).first()
  await userName.waitFor({ state: 'visible', timeout: 30_000 })
  await userName.fill(user.userName)
  const password = page.locator(LOGIN_PASSWORD_SELECTOR).first()
  await password.fill(user.password)
  await password.press('Enter')

  await solveCapWidget(page, { appearTimeoutMs: 10_000, timeoutMs: 60_000 })
  await page.waitForURL(url => url.pathname === expected, { timeout: 40_000 })
}

test.describe('WebAuthn journey', { tag: '@journey' }, () => {
  test('J6 虚拟认证器注册 → 同一凭据登录 ceremony（PG 凭据行 + counter 递增）', async ({ browser }) => {
    const root = await rootClient()
    // 新用户 mfa_setup=false ⇒ 登录后落 /mfa-required，走「强制绑定」的正向注册入口
    const { user } = await createJourneyUser(root, 'e2e-webauthn', { bindTotp: false })

    const session = await openDevice(browser, '/auth', { origin: WEBAUTHN_WEB_ORIGIN })
    const page = session.page
    const captured = captureEnvelopes(page, { origin: WEBAUTHN_WEB_ORIGIN })
    let cdp: CDPSession | null = null

    try {
      const authenticator = await addVirtualAuthenticator(page)
      cdp = authenticator.cdp

      // ─── 1. 注册 ceremony ─────────────────────────────────────────────────
      await test.step('注册：/mfa-required → 虚拟认证器 create → register/verify 20000', async () => {
        await loginUntilMfaPage(page, user, '/mfa-required')

        // 点卡片只打开弹窗；options / verify 两次请求都在「确认设备名」之后才发
        await page.getByTestId('mfa-required-method-webauthn').click()
        const modal = page.getByRole('dialog')
        await expect(modal, 'WebAuthn 绑定弹窗没有打开').toBeVisible({ timeout: 15_000 })

        const optionsResponse = page.waitForResponse(
          response => response.request().method() === 'POST' && response.url().endsWith(SystemEndpointRoutes.USER_MFA_WEBAUTHN_REGISTER_OPTIONS),
        )
        const verifyResponse = page.waitForResponse(
          response => response.request().method() === 'POST' && response.url().endsWith(SystemEndpointRoutes.USER_MFA_WEBAUTHN_REGISTER_VERIFY),
        )
        // 设备名已由 fingerprint 预填（canRegister 成立）；Enter 与「开始注册」按钮同一条 handler
        await modal.locator('input').first().press('Enter')

        const options = await (await optionsResponse).json() as ServerEnvelope<{ options: { challenge: string, rp: { id: string } } }>
        expect(options.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
        // 机器证明 RP 口径与浏览器 origin 对齐（127.0.0.1 会被 Chrome 直接拒）
        expect(options.data.options.rp.id, 'RP ID 必须等于页面 host（localhost）').toBe('localhost')

        const verifyBody = await (await verifyResponse).json() as ServerEnvelope<boolean>
        expect(verifyBody.code, `register/verify 失败：${verifyBody.msg ?? ''}`).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
        expect(verifyBody.data, 'register/verify 应返回 true').toBe(true)

        // 关掉成功弹窗（完成按钮 / Escape 任一），再点页面上的「验证」完成本次登录
        await page.keyboard.press('Escape')
        await expect(modal, '注册成功弹窗没有关闭').toBeHidden({ timeout: 10_000 })

        const mfaVerifyResponse = page.waitForResponse(
          response => response.request().method() === 'POST' && response.url().endsWith(`/api${AuthRoutes.MFA_VERIFY}`),
        )
        await page.getByTestId('mfa-required-verify-btn').click()
        const mfaVerifyBody = await (await mfaVerifyResponse).json() as ServerEnvelope<{ accessToken?: string }>
        expect(mfaVerifyBody.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
        await page.waitForURL(url => url.pathname !== '/mfa-required', { timeout: 40_000 })

        // 虚拟认证器里恰好一枚本 RP 的 resident 凭据
        const credentials = await readCredentials(authenticator.cdp, authenticator.authenticatorId)
        expect(credentials, '虚拟认证器里没有凭据（create 没落到认证器？）').toHaveLength(1)
        expect(credentials[0]!.rpId).toBe('localhost')
        expect(credentials[0]!.isResidentCredential).toBe(true)
      })

      // ─── 2. PG 凭据行 ────────────────────────────────────────────────────
      const credential = (await readCredentials(authenticator.cdp, authenticator.authenticatorId))[0]!
      const pgRow = await withPg(pg => findWebauthnMfaRow(pg, user.userId))
      expect(pgRow, 'sys_user_mfa 没有 webauthn 行').not.toBeNull()
      expect(pgRow!.status, '凭据行 status 应为启用').toBe(true)
      expect(pgRow!.credentialId, '库里的 credentialId 与虚拟认证器不一致').toBe(toBase64Url(credential.credentialId))
      expect(pgRow!.publicKeyCiphertextLength, '公钥密文为空（加密落库失败？）').toBeGreaterThan(0)
      await expect.poll(() => withPg(pg => readUserMfaSetup(pg, user.userId)), { timeout: 10_000 }).toBe(true)

      // ─── 3. 登录 ceremony ────────────────────────────────────────────────
      await test.step('登出 → 密码登录落 /mfa-verified → 虚拟认证器 get → authenticate/verify', async () => {
        // UI 登出（页头下拉 → 退出登录 → 确认）。useAppConfirm 是 naive-ui 的 dialog，
        // 正按钮文案是 `app.base.yes`（zh-CN = 确定），不是 popconfirm 的「确认」。
        await page.getByTestId('header-user-dropdown').hover()
        await page.getByText('退出登录', { exact: true }).click({ timeout: 10_000 })
        const signoutResponse = page.waitForResponse(
          response => response.request().method() === 'POST' && response.url().endsWith(`/api${AuthRoutes.SIGNOUT}`),
        )
        // 页面上有实时刷新的图表，naive dialog 的按钮在 headless 下被判「element is not stable」
        // 直到超时（多次复现）；这里对同一个 DOM 目标派发原生 click —— 要验的是「确认 → 登出
        // 请求 → 会话撤销 → 回登录页」这条链，按钮的命中测试不是被测行为。
        await page.getByRole('button', { name: '确定', exact: true }).evaluate((element) => {
          (element as HTMLElement).click()
        })
        const signoutBody = await (await signoutResponse).json() as ServerEnvelope<boolean>
        expect(signoutBody.code, `登出请求失败：${signoutBody.msg ?? ''}`).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
        await page.waitForURL(url => url.pathname === '/auth', { timeout: 30_000 })

        const counterBefore = (await withPg(pg => findWebauthnMfaRow(pg, user.userId)))!.counter

        await loginUntilMfaPage(page, user, '/mfa-verified')

        const authenticateOptions = page.waitForResponse(
          response => response.request().method() === 'POST' && response.url().endsWith(SystemEndpointRoutes.USER_MFA_WEBAUTHN_AUTHENTICATE_OPTIONS),
        )
        const authenticateVerify = page.waitForResponse(
          response => response.request().method() === 'POST' && response.url().endsWith(SystemEndpointRoutes.USER_MFA_WEBAUTHN_AUTHENTICATE_VERIFY),
        )
        // 只有 WebAuthn 一个方法启用（TOTP 未绑）⇒ /mfa-verified 的卡片唯一
        await page.getByTestId('mfa-method-card').first().click()

        const optionsBody = await (await authenticateOptions).json() as ServerEnvelope<{ options: { challenge: string, allowCredentials?: Array<{ id: string }> } }>
        expect(optionsBody.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
        expect(optionsBody.data.options.allowCredentials?.map(item => item.id), 'allowCredentials 应只含已注册的那枚凭据（base64url 口径）')
          .toEqual([toBase64Url(credential.credentialId)])

        const verifyBody = await (await authenticateVerify).json() as ServerEnvelope<{ accessToken?: string }>
        expect(verifyBody.code, `authenticate/verify 失败：${verifyBody.msg ?? ''}`).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
        expect(typeof verifyBody.data.accessToken, 'authenticate/verify 应轮换并返回新 AT').toBe('string')

        await page.waitForURL(url => url.pathname !== '/mfa-verified', { timeout: 30_000 })
        await expect(page.locator('[data-testid="sidebar-menu"], .w-menu').first()).toBeVisible({ timeout: 30_000 })

        // counter 递增 + last_used_at 落库（服务端防重放的真实证据）
        const afterLogin = await withPg(pg => findWebauthnMfaRow(pg, user.userId))
        expect(afterLogin!.counter, 'authenticate/verify 后 counter 应递增').toBeGreaterThan(counterBefore)
        expect(afterLogin!.lastUsedAt, 'authenticate/verify 后 last_used_at 应落库').not.toBeNull()

        const credentialsAfter = await readCredentials(authenticator.cdp, authenticator.authenticatorId)
        // CDP 的字段是 JSON 数字，但不同版本的编码可能给 string —— 比较前显式转
        expect(Number(credentialsAfter[0]!.signCount), '虚拟认证器的签名计数器没有递增').toBeGreaterThan(Number(credential.signCount))
      })
    }
    catch (error) {
      // 失败现场：socket / WebAuthn 的报错经常只剩一句 SecurityError，把页面与最近响应带上
      const context = await describeFailureContext(page, captured.entries).catch(() => '（失败现场不可读）')
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n[e2e/journey] WebAuthn 现场：\n${context}`, { cause: error })
    }
    finally {
      captured.stop()
      await cdp?.detach().catch(() => {})
      await session.context.close()
      await deleteLoginableUser(user)
    }
  })
})

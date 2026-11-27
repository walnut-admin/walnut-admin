/**
 * J10 MFA 强制绑定（Top 10 #8）：新用户 `mfa_setup=false` → 登录落 `/mfa-required`
 * → 点 TOTP 卡 → 扫码步拿 secret → 6 位码完成绑定（10 枚备用码）→ 点「验证」通过
 * `/auth/mfa/verify` → 进系统。
 *
 * 为什么必须是 UI 旅程：协议侧 M1/M2/M3 覆盖了「40114 / 40115 / bind/verify 契约」，
 * J6 覆盖了同一入口的 **WebAuthn** 腿；但 TOTP 的 `/mfa-required` 绑定弹窗（扫码 →
 * 验证码 → 完成）此前零覆盖 —— 它是新用户进入系统的唯一强制路径，断在这里所有功能都进不去。
 *
 * 断言分四层（缺一层就可能是「UI 看起来成功、库里没绑定」）：
 * 1. 生成：`totp/generate` 20000，`secret` 非空、`qrCode` 是 data URL；
 * 2. 绑定：`totp/bind` 20000，返回恰好 10 枚备用码（服务端一次性凭据的真实证据）；
 * 3. 登录：`/auth/mfa/verify` 20000 后离开 `/mfa-required` 并出现应用外壳；
 * 4. 落库：`sys_user_mfa` 的 totp 行存在且启用、备用码密文数组 10 项、
 *    `sys_user.mfa_setup=true`（M1 的起点翻转为 M2 的起点）。
 */
import { generateSync } from 'otplib'
import { deleteLoginableUser } from '../../lib/account-fixtures.ts'
import { openDevice, resolveDeviceId, trackDevice } from '../../lib/device-fixtures.ts'
import { findTotpMfaRow, readUserMfaSetup, withPg } from '../../lib/pg.ts'
import {
  AuthRoutes,
  SystemEndpointRoutes,
  WalnutAdminConstAppResponseCode,
} from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { SIDEBAR_MENU_SELECTOR } from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'
import { createJourneyUser, loginUntilMfaPage } from './journey-support.ts'

interface ServerEnvelope<T> {
  code: number
  data: T
  msg?: string
}

const TOTP_GENERATE_API_PATH = `/api${SystemEndpointRoutes.USER_MFA_TOTP_GENERATE}`
const TOTP_BIND_API_PATH = `/api${SystemEndpointRoutes.USER_MFA_TOTP_BIND}`
const MFA_VERIFY_API_PATH = `/api${AuthRoutes.MFA_VERIFY}`

test.describe('MFA 强制绑定 journey', { tag: '@journey' }, () => {
  test('J10 新用户强制绑定 TOTP：/mfa-required 扫码 → 6 位码 → 备用码 → 进系统', async ({
    browser,
  }) => {
    const root = await rootClient()
    // 新用户 mfa_setup=false ⇒ 登录后落 /mfa-required（不是 /mfa-verified）
    const { user } = await createJourneyUser(root, 'e2e-mfa-totp', { bindTotp: false })

    const session = await openDevice(browser, '/auth')
    const page = session.page

    try {
      await loginUntilMfaPage(page, user, '/mfa-required')
      session.deviceId = await resolveDeviceId(page)
      trackDevice(session.deviceId)

      // 起点：没有 TOTP 行、mfa_setup=false（与 M1 的矩阵边界一致）
      await withPg(async (pg) => {
        expect(await findTotpMfaRow(pg, user.userId), '新用户不应已有 totp 行').toBeNull()
        expect(await readUserMfaSetup(pg, user.userId), '新用户 mfa_setup 应为 false').toBe(false)
      })

      // ─── 1. 点 TOTP 卡 → generate（扫码步）────────────────────────────────
      // waitForResponse 必须先挂：点卡片就是 generate 的触发点
      const generateResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith(TOTP_GENERATE_API_PATH),
      )
      await page.getByTestId('mfa-required-method-totp').click()

      const generateBody = (await (await generateResponse).json()) as ServerEnvelope<{
        totpId: string
        secret: string
        qrCode: string
        account: string
      }>
      expect(generateBody.code, `totp/generate 失败：${generateBody.msg ?? ''}`).toBe(
        WalnutAdminConstAppResponseCode.SUCCESS,
      )
      expect(generateBody.data.secret, 'generate 响应缺 secret（扫码步无法完成绑定）').not.toBe('')
      expect(generateBody.data.qrCode, 'generate 响应缺 QR data URL').toMatch(/^data:image\//)

      const modal = page.getByRole('dialog')
      await expect(modal, 'TOTP 绑定弹窗没有打开').toBeVisible({ timeout: 15_000 })

      // ─── 2. 验证码步 → bind（10 枚备用码）─────────────────────────────────
      await page.getByTestId('mfa-required-totp-next-btn').click()
      const codeInput = page.getByTestId('mfa-required-totp-code-input')
      await expect(codeInput, '验证码输入框没有出现').toBeVisible({ timeout: 10_000 })

      // 用服务端刚生成的 secret 现算 6 位码（与真实验证器同一算法：30s / sha1 / 6 位）
      await codeInput.fill(generateSync({ secret: generateBody.data.secret }))

      const bindResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith(TOTP_BIND_API_PATH),
      )
      await page.getByTestId('mfa-required-totp-verify-btn').click()

      const bindBody = (await (await bindResponse).json()) as ServerEnvelope<{
        backupCodes: string[]
      }>
      expect(bindBody.code, `totp/bind 失败：${bindBody.msg ?? ''}`).toBe(
        WalnutAdminConstAppResponseCode.SUCCESS,
      )
      expect(bindBody.data.backupCodes, 'bind 应返回 10 枚备用码').toHaveLength(10)

      // ─── 3. 关闭完成弹窗 → 页面「验证」完成本次登录 ───────────────────────
      // step 3 只有块级「完成」按钮（closable=false，Escape / 遮罩都关不掉）
      await modal.locator('button').last().click()
      await expect(modal, '完成弹窗没有关闭').toBeHidden({ timeout: 10_000 })

      const mfaVerifyResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith(MFA_VERIFY_API_PATH),
      )
      await page.getByTestId('mfa-required-verify-btn').click()

      const mfaVerifyBody = (await (await mfaVerifyResponse).json()) as ServerEnvelope<{
        accessToken?: string
      }>
      expect(mfaVerifyBody.code, `/auth/mfa/verify 失败：${mfaVerifyBody.msg ?? ''}`).toBe(
        WalnutAdminConstAppResponseCode.SUCCESS,
      )
      expect(typeof mfaVerifyBody.data.accessToken, 'mfa/verify 应轮换并返回新 AT').toBe('string')

      await page.waitForURL((url) => url.pathname !== '/mfa-required', { timeout: 40_000 })
      await expect(
        page.locator(SIDEBAR_MENU_SELECTOR).first(),
        '验证通过后应进入应用外壳',
      ).toBeVisible({ timeout: 30_000 })

      // ─── 4. 落库：行存在 / 启用 / 备用码 10 枚 / mfa_setup 翻转 ───────────
      await expect
        .poll(() => withPg((pg) => readUserMfaSetup(pg, user.userId)), { timeout: 10_000 })
        .toBe(true)

      const totpRow = await withPg((pg) => findTotpMfaRow(pg, user.userId))
      expect(totpRow, '绑定后没有 sys_user_mfa totp 行').not.toBeNull()
      expect(totpRow!.status, 'totp 行应为启用').toBe(true)
      expect(totpRow!.backupCodesLeft, '备用码密文数组应有 10 项').toBe(10)
      expect(totpRow!.deviceId, 'totp 行应记录绑定设备').toBe(session.deviceId)
    } finally {
      await session.context.close()
      await deleteLoginableUser(user)
    }
  })
})

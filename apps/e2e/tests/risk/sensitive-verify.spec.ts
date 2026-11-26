/**
 * 敏感操作二次验证（40119）→ 全局 VerifyAuth → 验证后**自动重放原请求**（E2 回归）。
 *
 * ## 被测的那个断层
 *
 * `DELETE /system/user/identity/unbind/:type/:purpose`（以及 update / status）挂着
 * `@WalnutAdminGuardRequireSensitive({ level: 'account_critical', type: 'identity_manage' })`：
 * 本设备在 `sensitive_op:<userId>:<deviceId>:<level>` 没有授权时抛 **40119**。
 * 2026-11-26 之前 admin 的响应拦截器在这一分支只有 `TODO + console.log(123)` ——
 * 用户在 `/me` 安全页点「解绑」会直接吃一个错误 toast，弹窗、验证、重放一个都没有。
 *
 * 接线后的完整旅程（本文件钉住的就是它）：
 *
 * ```
 * 点解绑 → DELETE .../unbind/emailAddress/security → 40119(+meta 挑战描述符)
 *        → 全局 VerifyAuth 弹窗（方式由 meta.availableMethods 过滤）
 *        → 选 email（组件主动 send-code）→ 6 位码 → POST /security/sensitive/verify
 *        → 授权写 Redis（15 分钟）→ 弹窗关闭 → 拦截器重放原 DELETE → 20000
 * ```
 *
 * ## 判据（四件套，缺一不可）
 *
 * 1. **恰好两次** unbind 响应：`[40119, 20000]` —— 证明「弹了一次窗、只重放一次」；
 * 2. 授权键 `sensitive_op:<userId>:<deviceId>:account_critical` 存在（Redis）；
 * 3. 弹窗按 `meta.availableMethods` 收窄了方式（TOTP 已绑但不该出现）；
 * 4. PG：security 用途的身份行被删、login 用途不动（业务腿真的执行了）。
 *
 * ## 验证码从哪来
 *
 * 敏感验证的 email 通道走**本地缓存对码**（`SecuritySensitiveService.verifyEmailCode` →
 * `OtpSharedService.verifyCode('email', …)`），码就写在
 * `WALNUT_CACHE_AUTH:VERIFY_CODE:<userId>:<identifier>`（`AppTechCacheVerifyCodeService` 的
 * auth-user 通道，值形如 `{v:<code>,ttl,start,t}`）。这里从真实 Redis 读回，不走外网、
 * 不伪造服务端行为。**只读这一个精确键，不 FLUSH。**
 *
 * 身份 fixture 走真实协议（`check` 发码 → 读缓存 → `bind`，`setAsSecurity` 顺带建
 * security 用途行）—— 与 `/me` 页「绑定」按钮同一条链路，不直写 identity 表。
 *
 * 用户用**独立 context**（会改自己的身份凭据，不能污染共享登录态），设备由
 * `trackDevice` 登记给清理 fixture（断言失败也照清）。
 */
import type { Page } from '@playwright/test'
import type { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { createLoginableUser, deleteLoginableUser, loginAs } from '../../lib/account-fixtures.ts'
import { newBrowserContext, resolveDeviceId, trackDevice } from '../../lib/device-fixtures.ts'
import { findRoleIdByName, withPg } from '../../lib/pg.ts'
import { SystemEndpointRoutes, WalnutAdminConstAppResponseCode } from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { withRedis } from '../../lib/redis.ts'
import { captureEnvelopes, loginViaUI, waitForEnvelope } from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'

/** 验证码缓存的键前缀（`WalnutAdminConstAppCacheKeys.AUTH_VERIFY_CODE` + 服务端统一前缀） */
const VERIFY_CODE_KEY_PREFIX = 'WALNUT_CACHE_AUTH:VERIFY_CODE'

/** 40119 的 level（守卫装饰器写死 account_critical；verify 端点的必填入参） */
const SENSITIVE_LEVEL = 'account_critical'

/** unbind 端点的 URL 片段（前端经 /api 反代，用 endsWith 判） */
const UNBIND_EMAIL_SECURITY = '/system/user/identity/unbind/emailAddress/security'

/**
 * naive-ui 的确认对话框（`useAppConfirm` → `dialog.warning`）**没有 testid**
 * （E1 遗留第 4 条）：按结构取 action 区的最后一个按钮 = 肯定按钮
 * （`positiveText` = `app.base.yes`）。这是结构选择器，不是文案选择器 —— 换语言不断。
 *
 * 类名前缀是 **`w-` 不是 `n-`**：`App/src/naive/UIProvider.vue` 给 `n-config-provider`
 * 设了 `cls-prefix="w"`，所有 naive 组件的 DOM class 都跟着改（首次跑这一条时按 `n-dialog`
 * 选是选不到的 —— 弹窗明明开着，选择器等了一整个用例超时）。
 */
const CONFIRM_DIALOG_POSITIVE = '.w-dialog__action button:last-child'

/** 二次验证弹窗的元素（testid 见 admin `components/Global/VerifyAuth`） */
const METHOD_EMAIL = '[data-testid="verify-auth-method-email"]'
const METHOD_TOTP = '[data-testid="verify-auth-method-totp"]'
const VERIFY_CODE_BOX = '[data-testid="verify-auth-code"]'
const VERIFY_CODE_INPUTS = `${VERIFY_CODE_BOX} input`

interface SensitiveFixtureUser {
  userName: string
  password: string
  userId: string
  totpSecret: string
  /** 已绑定并验证的 security 用途邮箱（敏感验证的可用方式） */
  email: string
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

/**
 * 读 auth-user 的验证码缓存（`{v: <code>, ...}`）。发码是 `check` / `send-code` 的同步写，
 * 这里仍轮询 —— 避免「弹窗已切到输入步但缓存写入还没落地」的时序假设。
 */
async function waitForVerifyCode(userId: string, identifier: string, timeoutMs = 15_000): Promise<string> {
  const raw = await withRedis(async (redis) => {
    const key = `${VERIFY_CODE_KEY_PREFIX}:${userId}:${identifier}`
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = await redis.get(key)
      if (value !== null) {
        return value
      }
      if (Date.now() > deadline) {
        throw new Error(`[e2e/sensitive] ${timeoutMs}ms 内 ${key} 没有写入验证码（send-code 没发出去？）`)
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  })

  const parsed = JSON.parse(raw) as { v?: number | string }
  const code = parsed.v
  if (code === undefined || code === null) {
    throw new Error(`[e2e/sensitive] 验证码缓存的形状不是 {v:<code>}：${raw}`)
  }
  return String(code).padStart(6, '0')
}

/** 清掉本用例造的验证码键（按 userId + identifier 精确删；用户随后会被硬删，键否则残留到 TTL） */
async function deleteVerifyCode(userId: string, identifier: string): Promise<void> {
  await withRedis(redis => redis.del(`${VERIFY_CODE_KEY_PREFIX}:${userId}:${identifier}`))
}

/** security 用途的身份行数（`/me` 安全页的解绑对象就是它） */
async function countSecurityIdentity(userId: string, type: 'emailAddress' | 'phoneNumber'): Promise<number> {
  return withPg(async (pg) => {
    const { rows } = await pg.query<{ c: number }>(
      'SELECT count(*)::int AS c FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [userId, type, 'security'],
    )
    return rows[0]?.c ?? 0
  })
}

/** 该设备在 account_critical 级的敏感授权键是否存在（服务端 `sensitive_op:<userId>:<deviceId>:<level>`） */
async function hasSensitiveGrant(userId: string, deviceId: string): Promise<boolean> {
  return withRedis(async redis => (await redis.exists(`sensitive_op:${userId}:${deviceId}:${SENSITIVE_LEVEL}`)) === 1)
}

/**
 * 造一个可登录、已绑 TOTP、且**绑定了 security 用途邮箱**的用户。
 *
 * 角色用 seed 里的 `admin`：`/me` 页挂在 `me:auth:opaque:changePassword` 上，`admin` 角色的
 * 5 条菜单里正好有 `/me` + 那条 element（`root` 角色**不能**用 —— 它是 safe role，
 * `POST /system/user` 会直接 40000 拒掉，见 `WalnutAdminConstSafeRoleId`）。
 */
async function createSensitiveUser(userNamePrefix: string): Promise<SensitiveFixtureUser> {
  const root = await rootClient()
  const roleId = await withPg(pg => findRoleIdByName(pg, 'admin'))

  const user = await createLoginableUser(root, { userNamePrefix, roleId })

  // 协议侧把账号弄成「能过 MFA 的真实账号」：TOTP 绑定 + 设备级验证（mfa_setup=true）
  const client: WalnutProtocolClient = await loginAs(user)
  const totpSecret = await client.bindTotp()

  // 绑定 security 用途邮箱：check（发码）→ 读缓存 → bind（verified=true；setAsSecurity 建
  // purpose=security 的第二行）。这条路径与 `/me` 页「绑定」按钮完全一致。
  const email = uniqueEmail('e2e-sensitive')
  await client.root<boolean>('POST', `${SystemEndpointRoutes.USER_IDENTITY_CHECK}/emailAddress/login`, { identifier: email })
  const code = await waitForVerifyCode(user.userId, email)
  await client.root<boolean>('POST', `${SystemEndpointRoutes.USER_IDENTITY_BIND}/emailAddress/login`, {
    identifier: email,
    verifyCode: code,
    setAsSecurity: true,
  })

  const bound = await countSecurityIdentity(user.userId, 'emailAddress')
  if (bound !== 1) {
    throw new Error(`[e2e/sensitive] security 用途邮箱应有 1 行，实际 ${bound}`)
  }

  return { ...user, totpSecret, email }
}

/** 在页面里把 6 位码敲进 OTP（每格一个 input；输满由 onFinish 自动提交） */
async function typeOtp(page: Page, code: string): Promise<void> {
  const inputs = page.locator(VERIFY_CODE_INPUTS)
  await expect(inputs, '验证码输入框应有 6 格').toHaveCount(6)

  const current = await Promise.all(Array.from({ length: 6 }, (_, index) => inputs.nth(index).inputValue()))
  if (current.some(value => value !== '')) {
    // 上一轮（负对照）留下的数字必须先清掉，否则 onFinish 会被旧值提前触发
    for (let index = 0; index < 6; index += 1) {
      await inputs.nth(index).fill('')
    }
  }

  await inputs.first().click()
  await page.keyboard.type(code, { delay: 40 })
}

/** 走「点解绑 → 确认」：这一步之后拦截器应该拿到 40119 并弹窗 */
async function requestUnbindEmailSecurity(page: Page): Promise<void> {
  const emailAction = page.locator('[data-testid="me-security-email-action"]')
  await expect(emailAction, '/me 安全页应有邮箱操作菜单').toBeVisible({ timeout: 30_000 })

  // n-dropdown 是 hover 触发；testid 落在 dropdown 选项的 label 内（E1 加的）
  await emailAction.hover()
  await page.locator('[data-testid="me-security-email-unbind"]').click()
  await page.locator(CONFIRM_DIALOG_POSITIVE).click()
}

test.describe('敏感操作二次验证（40119）', { tag: '@risk' }, () => {
  test('S1 解绑安全邮箱：40119 → VerifyAuth → 验证后自动重放一次并成功', async ({ browser }) => {
    const user = await createSensitiveUser('e2e-sensitive-s1')
    const context = await newBrowserContext(browser)
    const page = await context.newPage()

    try {
      await page.goto('/auth')
      await loginViaUI(page, { userName: user.userName, password: user.password, totpSecret: user.totpSecret })

      const deviceId = await resolveDeviceId(page)
      trackDevice(deviceId)

      // 前置：本设备还没有 account_critical 授权
      expect(await hasSensitiveGrant(user.userId, deviceId), '登录后不应已有敏感授权').toBe(false)

      const envelopes = captureEnvelopes(page)

      try {
        await page.goto('/me/security/4')
        await requestUnbindEmailSecurity(page)

        // ① 弹窗出现，且方式被 meta.availableMethods 收窄成 email
        //    （该用户 TOTP 已绑定 —— 若客户端没按服务端清单过滤，这里会多出一张 totp 卡）
        await expect(page.locator(METHOD_EMAIL), '40119 应弹出全局二次验证（email 方式）').toBeVisible({ timeout: 20_000 })
        await expect(page.locator(METHOD_TOTP), 'TOTP 不在服务端给出的可用方式里，不该出现在弹窗').toHaveCount(0)

        // ② 选 email：组件这一侧主动 send-code（40119 没有调用方，弹窗就是入口）
        await page.locator(METHOD_EMAIL).click()
        await expect(page.locator(VERIFY_CODE_BOX)).toBeVisible({ timeout: 20_000 })

        // ③ 从真实缓存读码 → 输满 6 位 → onFinish 提交 /security/sensitive/verify
        const code = await waitForVerifyCode(user.userId, user.email)
        await typeOtp(page, code)

        // ④ 弹窗关闭 + 原 DELETE 被自动重放
        await expect(page.locator(METHOD_EMAIL), '验证成功后弹窗应关闭').toBeHidden({ timeout: 20_000 })
        await waitForEnvelope(
          envelopes.entries,
          entry => entry.url.endsWith(UNBIND_EMAIL_SECURITY) && entry.code === WalnutAdminConstAppResponseCode.SUCCESS,
          20_000,
        )

        // ⑤ 恰好两次 unbind：40119（被拦）→ 20000（重放成功）。多于两次 = 重入 / 无限弹窗。
        const unbindCalls = envelopes.entries.filter(entry => entry.url.endsWith(UNBIND_EMAIL_SECURITY))
        expect(
          unbindCalls.map(entry => entry.code),
          'unbind 应恰好两次：先 40119 再 20000（验证后只重放一次）',
        ).toEqual([
          WalnutAdminConstAppResponseCode.UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED,
          WalnutAdminConstAppResponseCode.SUCCESS,
        ])

        // ⑥ 授权键落在本设备 + 本 level 上（服务端行为，不是前端伪造的放行）
        expect(await hasSensitiveGrant(user.userId, deviceId), '验证通过后应有 sensitive_op 授权键').toBe(true)

        // ⑦ UI 状态跟着变：邮箱行回到「未绑定」（操作菜单消失）
        await expect(page.locator('[data-testid="me-security-email-action"]')).toHaveCount(0, { timeout: 20_000 })

        // ⑧ PG：security 用途行被删、login 用途行不动（业务腿真的执行了）
        expect(await countSecurityIdentity(user.userId, 'emailAddress'), 'security 身份行应已删除').toBe(0)
        const loginRows = await withPg(async (pg) => {
          const { rows } = await pg.query<{ c: number }>(
            'SELECT count(*)::int AS c FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
            [user.userId, 'emailAddress', 'login'],
          )
          return rows[0]?.c ?? 0
        })
        expect(loginRows, 'login 用途的邮箱身份不该被这条旅程动到').toBe(1)
      }
      finally {
        envelopes.stop()
      }
    }
    finally {
      await context.close()
      await deleteVerifyCode(user.userId, user.email)
      await deleteLoginableUser(user)
    }
  })

  test('S2 负对照：验证码错 → 弹窗不关、原解绑请求不放行；改对后恢复', async ({ browser }) => {
    const user = await createSensitiveUser('e2e-sensitive-s2')
    const context = await newBrowserContext(browser)
    const page = await context.newPage()

    try {
      await page.goto('/auth')
      await loginViaUI(page, { userName: user.userName, password: user.password, totpSecret: user.totpSecret })

      const deviceId = await resolveDeviceId(page)
      trackDevice(deviceId)

      const envelopes = captureEnvelopes(page)

      try {
        await page.goto('/me/security/4')
        await requestUnbindEmailSecurity(page)

        await expect(page.locator(METHOD_EMAIL)).toBeVisible({ timeout: 20_000 })
        await page.locator(METHOD_EMAIL).click()
        await expect(page.locator(VERIFY_CODE_BOX)).toBeVisible({ timeout: 20_000 })

        const code = await waitForVerifyCode(user.userId, user.email)
        // 错码 = 真码 +1（同一长度，必不相等；服务端对 email 通道只做等值比较，不消费码）
        const wrongCode = String((Number(code) + 1) % 1_000_000).padStart(6, '0')
        expect(wrongCode).not.toBe(code)

        await typeOtp(page, wrongCode)

        // ① 弹窗不关：错误提示由拦截器 toast，弹窗留在验证码步
        //    （方法卡是 v-show 隐藏而不是卸载 —— 判据用「不可见」，不是「不在 DOM」）
        await expect(page.locator(VERIFY_CODE_BOX), '错码不应关闭弹窗').toBeVisible({ timeout: 10_000 })
        await expect(page.locator(METHOD_EMAIL), '错码后仍应停在验证码步，不该回到方式选择').toBeHidden()

        // ② 原请求不放行：unbind 只有一次 40119，没有 20000
        const unbindCalls = envelopes.entries.filter(entry => entry.url.endsWith(UNBIND_EMAIL_SECURITY))
        expect(
          unbindCalls.map(entry => entry.code),
          '错码时原解绑请求应一直挂着（只有 40119，没有重放）',
        ).toEqual([WalnutAdminConstAppResponseCode.UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED])

        // ③ 业务状态没被动过：身份行还在、没有授权键
        expect(await countSecurityIdentity(user.userId, 'emailAddress'), '错码不应删掉身份行').toBe(1)
        expect(await hasSensitiveGrant(user.userId, deviceId), '错码不应写授权键').toBe(false)

        // ④ 恢复：改对码 → 弹窗关闭 → 挂着的原请求被重放并成功
        await typeOtp(page, code)
        await expect(page.locator(VERIFY_CODE_BOX), '正确验证码应关闭弹窗').toBeHidden({ timeout: 20_000 })
        await waitForEnvelope(
          envelopes.entries,
          entry => entry.url.endsWith(UNBIND_EMAIL_SECURITY) && entry.code === WalnutAdminConstAppResponseCode.SUCCESS,
          20_000,
        )
        expect(await countSecurityIdentity(user.userId, 'emailAddress'), '验证通过后身份行应删除').toBe(0)
      }
      finally {
        envelopes.stop()
      }
    }
    finally {
      await context.close()
      await deleteVerifyCode(user.userId, user.email)
      await deleteLoginableUser(user)
    }
  })
})

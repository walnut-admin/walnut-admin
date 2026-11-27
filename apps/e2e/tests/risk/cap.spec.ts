/**
 * risk 矩阵 U13：post-auth CAP 重武装。
 *
 * 用例表把「40111 + CAP 对话框可见 + 重放成功」写成一条，但当前代码里这三件事分属两条路径
 * （以服务端 / 前端实现为准，不臆改口径）：
 * - **40111**（`UNAUTHORIZED_BOT_VERIFY_FAILED`）只在「**签名合法**、值不是 cap.js token 形态」时
 *   抛出（cap.guard 的 `performCapVerification`）。用户端改 cookie 只会得到未签名值 ⇒ 被当成
 *   缺失（40116）；伪造签名需要 cookie secret，本仓只有服务端持有。前端把 40111 映射到
 *   `/not-allowed?type=capjsTokenInvalid`（不是 CAP 对话框）。
 * - **CAP 对话框 + 重放成功** 属于 40116（`UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED`）。
 *   但守卫链决定了对话框只能由 **pre-auth 腿**的 critical 因子触发：pre-auth CAP guard 在
 *   shouldChallenge=false 且凭据缺失时回 40117（静默刷新），而 token 有效时 post-auth 腿
 *   命中同一份缓存直接放行 —— 当前代码里不存在「只有 post-auth 因子、单靠它就弹出对话框」
 *   的可达路径（U13 的实现按真实链路验证：pre-auth 因子触发对话框，重放请求的 post-auth
 *   腿写出 USER_DEVICE_UNTRUSTED 标记；这条标记只有 post-auth 腿写得出来）。
 *
 * 所以拆成两条用例：U13 走 UI 验「对话框 + 重放成功 + post-auth 因子标记」，U13b 用
 * 「持有 secret 的一方才造得出的畸形签名 cookie」验 40111 本体及其恢复路径。完整分歧记在
 * 汇报里，不悄悄改计划页口径。
 */
import { loginDevice, trackDevice, uniqueLocalIp } from '../../lib/device-fixtures.ts'
import { findUserDeviceRow, findUserIdByUserName, withPg } from '../../lib/pg.ts'
import { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { SystemEndpointRoutes, SystemRoutes, WalnutAdminConstAppResponseCode } from '../../lib/protocol/contract.ts'
import { signCookieValue } from '../../lib/protocol/cookie-sign.ts'
import {
  deleteCapTokenCache,
  deleteRiskDeviceState,
  riskChallengeUserDeviceKey,
  withRedis,
} from '../../lib/redis.ts'
import {
  captureEnvelopes,
  navigateInApp,
  solveCapWidget,
  waitForCapWidget,
  waitForEnvelope,
} from '../../lib/ui.ts'
import { CAPJS_COOKIE_NAME, readCredentials, readServerCookieSecret } from '../../scripts/env.ts'
import { expect, test } from '../fixtures.ts'
import { RISK_FACTOR } from './risk-support.ts'

test.describe('post-auth CAP 重武装', { tag: '@risk' }, () => {
  test('U13 CAP 重新武装：40116 → cap-widget → 求解后重放 20000（post-auth 因子由同一请求的后鉴权腿标记）', async ({ browser }) => {
    const credentials = readCredentials()
    // UI 登录的 MFA 页面复选框默认**未勾选**（trusted=false）—— 这正是 post-auth
    // USER_DEVICE_UNTRUSTED 因子的真实来源，不需要额外改库。
    const session = await loginDevice(browser)
    const deviceId = session.deviceId

    try {
      const userId = await withPg(pg => findUserIdByUserName(pg, credentials.userName))
      await withPg(async (pg) => {
        const row = await findUserDeviceRow(pg, userId, deviceId)
        expect(row, `sys_user_device 没有 (${userId}, ${deviceId}) 的行`).not.toBeNull()
        expect(row!.trusted, 'UI 登录未勾选 trusted，user_device.trusted 应为 false').toBe(false)
      })

      // 登录链路已经解过一次 CAP：DEVICE_NEW / USER_DEVICE_UNTRUSTED 都有 handled 标记。
      // 全部清掉 = 重新武装（真实等价于「凭据过期 + 标记过期」），并同时删 CAP 校验缓存、
      // 清掉 CAPJS_TOKEN cookie：
      // - 不删缓存 / 不清 cookie：请求会命中缓存静默通过，看不到任何交互；
      // - 只删缓存不清 cookie：实测 pre-auth 腿先用「已消费 token」判 40117（静默刷新），
      //   因为 pre-auth 的 critical 因子仍算 handled —— 这一步必须让 pre-auth 也重新挑战。
      await withRedis(async (redis) => {
        await deleteRiskDeviceState(redis, deviceId)
        await deleteCapTokenCache(redis, deviceId)
      })
      await session.context.clearCookies({ name: CAPJS_COOKIE_NAME })

      // 前置证据：清完之后 user-device 的标记确实没了（求解前它必须是 unhandled）
      const clearedMarker = await withRedis(redis => redis.exists(
        riskChallengeUserDeviceKey(userId, deviceId, RISK_FACTOR.USER_DEVICE_UNTRUSTED),
      ))
      expect(clearedMarker, '清理后 USER_DEVICE_UNTRUSTED 的标记仍在').toBe(0)

      const captured = captureEnvelopes(session.page)
      // 已挂载应用里的真实导航（不 reload）：用户页挂载时自己发列表请求
      await navigateInApp(session.page, SystemRoutes.USER)

      // 目标是被导航触发的列表请求（URL 固定），不拿后台心跳的 40116 充数
      const rejected = await waitForEnvelope(
        captured.entries,
        entry => entry.url.endsWith(`${SystemRoutes.USER}/list`)
          && entry.code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED,
        40_000,
      )
      const rejectedIndex = captured.entries.indexOf(rejected)

      // 「CAP 对话框可见」：cap-widget 真的出现在页面上（不是只靠响应码推断）
      await waitForCapWidget(session.page, 15_000)

      // 求解：点 widget → PoW → 拦截器重放原请求
      const solved = await solveCapWidget(session.page, { timeoutMs: 60_000 })
      expect(solved, 'cap-widget 已可见但点击求解失败').toBe(true)

      // 「验证通过后同一请求重放成功」：同一个 URL 在 40116 之后出现 20000
      const replayed = await waitForEnvelope(
        captured.entries,
        entry => entry.url === rejected.url && entry.code === WalnutAdminConstAppResponseCode.SUCCESS,
        40_000,
        rejectedIndex + 1,
      )
      expect(replayed.code, `重放 ${rejected.url} 没有回到 20000`).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

      // 状态落点 1：post-auth critical factor 被重放请求的**后鉴权腿**标为已处理
      // （服务端 api-spec 已确证：USER_DEVICE_UNTRUSTED 的标记只有 post-auth 腿写得出来）。
      const userDeviceMarker = await withRedis(redis => redis.exists(
        riskChallengeUserDeviceKey(userId, deviceId, RISK_FACTOR.USER_DEVICE_UNTRUSTED),
      ))
      expect(userDeviceMarker, 'USER_DEVICE_UNTRUSTED 的挑战标记没有落 Redis').toBe(1)

      // 状态落点 2：pre-auth 的 critical 因子同样被这次求解覆盖（同一枚 CAP token 标记两腿）
      const deviceMarker = await withRedis(redis => redis.exists(
        `risk:challenge:device:${deviceId}:${RISK_FACTOR.DEVICE_NEW}`,
      ))
      expect(deviceMarker, 'DEVICE_NEW 的挑战标记没有落 Redis').toBe(1)

      captured.stop()
    }
    finally {
      await session.context.close()
    }
  })

  test('U13b 40111：签名合法但非 cap.js 形态的 CAP 凭据 → 40111，换真凭据后同一请求成功', async () => {
    const credentials = readCredentials()
    const client = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
    await client.bootstrap()
    trackDevice(client.deviceId)
    await client.login(credentials.userName, credentials.password)
    await client.verifyTotpForDevice(credentials.totpSecret)

    const tokens = client.tokens
    if (tokens === null) {
      throw new Error('[e2e] 登录后没有 tokens')
    }
    const authHeader = { Authorization: `Bearer ${tokens.accessToken}` }

    // 签名合法（持有 APP_COOKIE_SECRET）+ 值不是 `<hex>:<hex>` ⇒ 40111 的唯一入口。
    // ⑤（2026-11）：secret 已换成不含 `#` 的十六进制串，E2E 直读与 dotenv 解析同值
    // （此前的「按 # 截断」分支在 readServerCookieSecret 里，已随换值删掉）。
    const cookieSecret = readServerCookieSecret()
    const forged = signCookieValue('not-a-cap-token', cookieSecret)
    client.setCookie(CAPJS_COOKIE_NAME, encodeURIComponent(forged))

    const blocked = await client.requestFree<{ code: number, msg?: string }>('GET', SystemEndpointRoutes.USER_ME_PROFILE, {
      headers: authHeader,
    })
    expect(
      blocked.code,
      `畸形签名 CAP cookie 应回 40111，实际 ${blocked.code} ${blocked.msg ?? ''}`,
    ).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_BOT_VERIFY_FAILED)

    // 恢复路径：重新领一枚真 CAP token（challenge → PoW → redeem），同一请求重放成功
    await client.refreshCapToken()
    const replayed = await client.request('GET', SystemEndpointRoutes.USER_ME_PROFILE, { headers: authHeader })
    expect(replayed.code, '换真 CAP 凭据后同一请求仍失败').toBe(WalnutAdminConstAppResponseCode.SUCCESS)
  })
})

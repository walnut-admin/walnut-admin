import type { Page } from '@playwright/test'
import { deleteLoginableUser, loginAs, setUserPasswordViaAdmin } from '../../lib/account-fixtures.ts'
import { openDevice, resolveDeviceId, trackDevice } from '../../lib/device-fixtures.ts'
import { countActiveRefreshTokensForDevice, findMonitorUserRow, withPg } from '../../lib/pg.ts'
import { SystemEndpointRoutes, WalnutAdminConstAppResponseCode } from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { authSessionKeyPattern, scanKeys, withRedis } from '../../lib/redis.ts'
import { captureEnvelopes, LOGIN_USERNAME_SELECTOR, loginViaUI } from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'
import { captureSocketFrames, createJourneyUser, waitForSocketConnected, waitForSocketEvent } from './journey-support.ts'

/**
 * J5 socket 强踢：管理员重置口令 → 目标浏览器收到 `force:quit` → 自动登出。
 *
 * 这是全仓**唯一** socket → DOM 通道（调研报告 §2.4）：api-spec 只证「RT 被撤、旧 AT 40101」，
 * socket 是否真的投递、前端是否真的按策略登出，此前没有任何一层证过。
 *
 * 服务端真源（写断言前已对照）：
 * - `POST /auth/opaque/admin/password/update/finish` → `AuthOpaqueAdminService.finishChangePassword`
 *   → `AuthSignoutService.doSignout(trigger='security-policy', revokeReason='updatePass')`
 *   → 撤该用户**全部**设备的 RT + 清会话 / 权限 / MFA verified 缓存 +（提交后）
 *   `forceQuitMonitorsBySocket(userId, 'updatePass')`；
 * - 投递面按 `app_monitor_user`（`auth=true && !left`）逐行 `sendToUserRoom(userId, visitorId, FORCE_QUIT)`，
 *   策略取 `app.global.forceQuit.config.updatePass` —— seed 是 `FORCE_IMMEDIATE_SIGNOUT`
 *   （`db/seed/app_setting.json`），前端 `socket/index.ts` 对它的反应是 `Signout()`；
 * - monitor 行由登录后的心跳（`POST /app/monitor/user/state`，带 AT）写入 —— 浏览器设备
 *   必须先有心跳行，socket 才可能收到事件（前置断言，失败原因落在「心跳/在线态」而不是等帧超时）。
 *
 * 两条设备腿：协议客户端（设备 A，造号时登录并绑 TOTP）+ 浏览器（设备 B，真实 UI 登录）。
 * 重置后两台的 RT / 会话键都必须归零 —— 「重置口令 = 全端下线」是服务端语义，不是单设备行为。
 */

interface ServerEnvelope<T = Record<string, unknown>> {
  code: number
  data: T
  msg?: string
}

/** 从采集到的请求头里取最近一枚 Bearer AT（浏览器 localStorage 的 AT 是加密的，只能从线上抓） */
function collectBearerTokens(page: Page): string[] {
  const tokens: string[] = []
  page.on('request', (request) => {
    if (!request.url().includes('/api/')) {
      return
    }
    const auth = request.headers().authorization
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length)
      if (token !== '') {
        tokens.push(token)
      }
    }
  })
  return tokens
}

test.describe('socket 强踢 journey', { tag: '@journey' }, () => {
  test('J5 管理员重置口令 → 浏览器收到 FORCE_QUIT → 自动登出；两台设备会话全部失效', async ({ browser }) => {
    const root = await rootClient()
    const { user, totpSecret, client: deviceA } = await createJourneyUser(root, 'e2e-force-quit', { bindTotp: true })
    expect(totpSecret).not.toBeNull()

    const session = await openDevice(browser, '/auth')
    const page = session.page
    // socket 监听必须在登录前挂：socket 在登录后的 getProfile 里建立
    const socketFrames = captureSocketFrames(page)
    const bearerTokens = collectBearerTokens(page)
    const captured = captureEnvelopes(page)

    try {
      await loginViaUI(page, { userName: user.userName, password: user.password, totpSecret: totpSecret! })
      session.deviceId = await resolveDeviceId(page)
      trackDevice(session.deviceId)

      // 0. 前置：socket 命名空间已连接（登录后的 setupSocket）+ 心跳行已上报（auth=true, left=false）
      await waitForSocketConnected(socketFrames)
      await expect.poll(
        async () => withPg(pg => findMonitorUserRow(pg, user.userId, session.deviceId)),
        { timeout: 20_000, message: '浏览器设备没有 app_monitor_user 心跳行（在线态没建立，socket 不可能收到强踢）' },
      ).toMatchObject({ auth: true, left: false })

      const oldBrowserAt = bearerTokens.at(-1)
      expect(oldBrowserAt, 'UI 登录后没有采集到浏览器的 AT（登录链路没完成？）').toBeTruthy()

      // 1. 管理员重置口令（真实 admin 端点；finish 内部触发 security-policy 全链）
      const newPassword = `E2e-reset-${Date.now()}`
      await setUserPasswordViaAdmin(root, user, newPassword)

      // 2. socket 投递：帧里必须有 force:quit，且策略是 seed 的 immediate signout
      const frame = await waitForSocketEvent(
        socketFrames,
        'force:quit',
        '重置口令后浏览器没收到 FORCE_QUIT（socket 投递链断了 / 心跳行不在房间）',
        20_000,
        page,
      )
      expect(frame).toContain('FORCE_IMMEDIATE_SIGNOUT')

      // 3. DOM 落地：自动登出回登录页，应用外壳卸载
      await page.waitForURL(url => url.pathname === '/auth', { timeout: 30_000 })
      await expect(page.locator(LOGIN_USERNAME_SELECTOR).first()).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('[data-testid="sidebar-menu"], .w-menu')).toHaveCount(0)

      // 设备身份在登出后保留（证明是 signout 而不是设备重置 —— 后者会清 DEVICE_ID cookie）
      const deviceCookieAfter = (await page.context().cookies()).find(cookie => cookie.name === 'DEVICE_ID')
      expect(deviceCookieAfter, '登出后 DEVICE_ID cookie 不应被清（设备身份与登录态是两件事）').toBeTruthy()

      // 4. 旧 AT 被拒：40101（JWT validate 查 AUTH:SESSIONS 会话键，已随 security-policy 清空）
      const replay = await page.evaluate(async ({ at, url }) => {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${at}` },
          credentials: 'include',
        })
        return await response.json() as { code: number }
      }, { at: oldBrowserAt!, url: '/api/system/user/me/profile' })
      expect(replay.code, `旧 AT 重放应 40101（会话键已清），实际 ${replay.code}`)
        .toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

      // 5. 两台设备服务端归零：RT 撤销 + 会话键清空
      for (const deviceId of [deviceA.deviceId, session.deviceId]) {
        await expect.poll(
          () => withPg(pg => countActiveRefreshTokensForDevice(pg, deviceId)),
          { timeout: 10_000, message: `设备 ${deviceId} 的现役 RT 没有被撤销` },
        ).toBe(0)
        await expect.poll(
          () => withRedis(client => scanKeys(client, authSessionKeyPattern(deviceId))),
          { timeout: 10_000, message: `设备 ${deviceId} 的 AUTH:SESSIONS 键没有清空` },
        ).toEqual([])
      }

      // 6. 协议设备的旧 AT 同样被拒（40101）—— 全端下线，不是只踢浏览器
      const deviceATokens = deviceA.tokens
      expect(deviceATokens, '协议设备建号后应有登录态').not.toBeNull()
      const protocolReplay = await deviceA.requestFree<ServerEnvelope>(
        'GET',
        SystemEndpointRoutes.USER_ME_PROFILE,
        { sign: false, headers: { Authorization: `Bearer ${deviceATokens!.accessToken}` } },
      )
      expect(protocolReplay.code, '协议设备的旧 AT 应 40101').toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

      // 7. 新口令可用（重置不只是踢人，口令真的换了）：新设备 + 新口令能完成 OPAQUE 登录
      const relogin = await loginAs({ userName: user.userName, password: newPassword })
      expect(relogin.tokens, '重置后的新口令无法完成 OPAQUE 登录').not.toBeNull()
    }
    finally {
      captured.stop()
      await session.context.close()
      await deleteLoginableUser(user)
    }
  })
})

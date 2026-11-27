/**
 * journey（E5）共享 fixture：一次性账号、UI 登录会话、socket 帧采集。
 *
 * 与 `lock-support.ts` 的分工：那边只服务锁屏闭环（锁偏好 / 锁设备 / 解锁）；这里的
 * `createJourneyUser` / `openLoggedInDevice` 是五条旅程都要的「造可登录账号 + 起一台
 * 真设备」两件事。锁屏用例继续用自己那份（锁屏对账号有额外状态假设），本文件不搬它。
 *
 * 纪律（与 L2 同口径）：
 * - **一次性账号**：每条用例建自己的用户，结束后硬删；不要复用 stack 的 admin。
 * - **每台设备独立 127/8 地址**：一律经 `openDevice` / `loginAs`（内部 `uniqueLocalIp`），
 *   别手写 IP（`device/initial` 是 4 次/60 秒 per realIp）。
 * - **socket 等待带上下文**：`captureSocketFrames` 双通道（WebSocket 帧 + `/socket/` 轮询
 *   响应）采集，`waitForSocketEvent` 超时把页面状态与最近业务响应一起抛出来 —— 不许裸
 *   `waitForTimeout` 之后断言数组长度。
 */
import type { Browser, Page } from '@playwright/test'
import type { LoginableUser } from '../../lib/account-fixtures.ts'
import type { DeviceSession } from '../../lib/device-fixtures.ts'
import type { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { createLoginableUser, loginAs } from '../../lib/account-fixtures.ts'
import { openDevice, resolveDeviceId, trackDevice } from '../../lib/device-fixtures.ts'
import { findRoleIdByName, withPg } from '../../lib/pg.ts'
import {
  describeFailureContext,
  LOGIN_PASSWORD_SELECTOR,
  LOGIN_USERNAME_SELECTOR,
  loginViaUI,
  markAppIntroSeen,
  settlePostLoginCap,
  snapshotRecentEnvelopes,
  solveCapWidget,
} from '../../lib/ui.ts'

export interface JourneyUser {
  user: LoginableUser
  roleId: string
  /** 已绑定 TOTP 时的 secret（`bindTotp:false` 时为 null） */
  totpSecret: string | null
  /** 建号时登录的协议设备（已 MFA 验证；`bindTotp:false` 时未验证） */
  client: WalnutProtocolClient
}

/**
 * root 建号 → 真实 OPAQUE 登录 →（可选）绑 TOTP。
 *
 * `bindTotp` 决定账号的 MFA 状态，也决定之后 UI 登录走到哪一页：
 * - `true`（默认）：登录后 `/mfa-verified`，`loginViaUI` + TOTP 直接进系统；
 * - `false`：`mfa_setup=false`，登录后落在 `/mfa-required`（新用户强制绑定）——
 *   WebAuthn 注册旅程要的正是这个起点。
 *
 * 建号用的角色决定 `/auth/permissions`（菜单 / 权限串），而 MFA guard 不看角色
 * （visitor 除外），所以任何非 visitor 角色都能走真实 UI 登录。
 */
export async function createJourneyUser(
  root: WalnutProtocolClient,
  prefix: string,
  options: { roleName?: string; roleId?: string; bindTotp?: boolean } = {},
): Promise<JourneyUser> {
  const roleName = options.roleName ?? 'admin'
  const roleId = options.roleId ?? (await withPg((pg) => findRoleIdByName(pg, roleName)))
  const user = await createLoginableUser(root, { userNamePrefix: prefix, roleId })
  const client = await loginAs(user)
  const totpSecret = options.bindTotp === false ? null : await client.bindTotp()

  return { user, roleId, totpSecret, client }
}

/**
 * 密码登录到 MFA 页（**不处理 MFA 本身**）：启动 CAP → 提交 → 登录后 CAP 竞速
 * （`settlePostLoginCap`，与 `loginViaUI` 同一口径，不盲等 10s）→ 等 `/mfa-required`
 * 或 `/mfa-verified`。`expected` 由调用方声明 —— 走错页面是「账号 MFA 状态与预期不符」，
 * 要在这一步说清，而不是后面点不到卡片。
 *
 * J6（WebAuthn）与 J10（强制绑定 TOTP）共用；新用例别再手写一份登录序列
 * （复制出来的版本会各自漂移 CAP 等待口径）。
 */
export async function loginUntilMfaPage(
  page: Page,
  user: Pick<LoginableUser, 'userName' | 'password'>,
  expected: '/mfa-required' | '/mfa-verified',
): Promise<void> {
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

  await settlePostLoginCap(page)
  await page.waitForURL((url) => url.pathname === expected, { timeout: 40_000 })
}

/** 新设备 + 完整 UI 登录（CAP + MFA），返回已登录会话（设备已登记给清理 fixture） */
export async function openLoggedInDevice(
  browser: Browser,
  user: LoginableUser,
  totpSecret: string,
  options: { origin?: string } = {},
): Promise<DeviceSession> {
  const session = await openDevice(browser, '/auth', { origin: options.origin })
  await loginViaUI(session.page, {
    userName: user.userName,
    password: user.password,
    totpSecret,
  })
  session.deviceId = await resolveDeviceId(session.page)
  trackDevice(session.deviceId)
  return session
}

/**
 * 监听 socket.io 的服务端事件（机器证据）。
 *
 * 同时收两条腿：WebSocket 帧（升级完成后）与 `/socket/` 的 HTTP 长轮询响应
 * （engine.io 在 upgrade 之前 / 被代理挡住时会走 polling）。只按事件名包含判断，
 * 不解析 socket.io 协议细节 —— 要证明的是「服务端把事件发到了本浏览器」。
 *
 * 必须在**登录前**挂：socket 在登录后的 `getProfile` 里建立，晚了看不到已连上的那条。
 */
export function captureSocketFrames(page: Page): string[] {
  const frames: string[] = []

  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => {
      frames.push(
        typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8'),
      )
    })
  })

  page.on('response', (response) => {
    if (!response.url().includes('/socket/')) {
      return
    }
    void response
      .text()
      .then((body) => {
        frames.push(body)
      })
      .catch(() => {})
  })

  return frames
}

/** socket.io 的命名空间连接确认帧（engine.io open 之后是 `40/<namespace>,{...}`） */
export async function waitForSocketConnected(frames: string[], timeoutMs = 30_000): Promise<void> {
  await waitForSocketEvent(
    frames,
    '40/',
    'socket 命名空间没有完成连接（login 后的 setupSocket 没跑 / 握手被拒）',
    timeoutMs,
  )
}

/**
 * 等某个 socket 事件出现在采集帧里（轮询，**带失败上下文**）。
 *
 * 超时错误里带：目标事件名、最近 20 条帧（截断）、页面 URL / CAP / 设备 id、最近 12 条
 * 业务响应 —— 与 `waitForEnvelope` 同一份取证口径（socket 故障的现场往往同时是
 * 「登录态 / 设备 / 权限」的问题，只看帧列表看不出是哪一层）。
 */
export async function waitForSocketEvent(
  frames: string[],
  needle: string,
  what: string,
  timeoutMs = 20_000,
  page?: Page,
): Promise<string> {
  const started = Date.now()
  for (;;) {
    const hit = frames.find((frame) => frame.includes(needle))
    if (hit !== undefined) {
      return hit
    }
    if (Date.now() - started > timeoutMs) {
      const context =
        page === undefined
          ? ''
          : `\n${await describeFailureContext(page, snapshotRecentEnvelopes(12))}`
      const tail = frames
        .slice(-20)
        .map((frame) => `  ${frame.slice(0, 240)}`)
        .join('\n')
      throw new Error(
        `[e2e/journey] ${Math.round(timeoutMs / 1000)}s 内没等到 socket 事件 ${needle}（${what}）。` +
          `\n最近 ${Math.min(frames.length, 20)} 条 socket 帧：\n${tail === '' ? '  <一条都没有采集到 —— captureSocketFrames 是否在登录前挂上？>' : tail}${
            context
          }`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

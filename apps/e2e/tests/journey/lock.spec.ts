import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { deleteLoginableUser } from '../../lib/account-fixtures.ts'
import { openDevice, resolveDeviceId, trackDevice } from '../../lib/device-fixtures.ts'

import {
  countLockResetAuditRows,
  expireLockBackoff,
  findUserDeviceRow,
  findUserLockRow,
  withPg,
} from '../../lib/pg.ts'
import { WalnutProtocolRequestError } from '../../lib/protocol/client.ts'
import { SystemEndpointRoutes, WalnutAdminConstAppResponseCode } from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import {
  deleteMfaVerifiedCache,
  deleteUserLockCache,
  readLockCache,
  withRedis,
} from '../../lib/redis.ts'
import { captureEnvelopes, loginViaUI, navigateInApp, verifyMfaIfPresent, waitForEnvelope } from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'
import { waitForSocketConnected } from './journey-support.ts'
import {
  createLockTestUser,
  lockDevice,
  loginVerifiedDevice,
  openLoggedInDevice,
  securityLockPreference,
  setLockPreference,
  unlockDevice,
} from './lock-support.ts'

/**
 * 锁屏闭环（L2 的首个 journey 用例组）。
 *
 * 协议优先、UI 只出现在「必须点出来」的环节：
 * - J1：设置表单（含**信封请求体**的网络断言）→ `/lock` 密码框 → 退避 → 正确密码；
 * - J2：忘记锁屏密码 → OPAQUE 登录口令 fallback（含 40115 → `/mfa-verified` 的 D3 回归）；
 * - J3：root 在用户管理行内重置被锁用户（轻 UI）+ 审计行；
 * - J4：登录即解锁（`lockCrossDevice` 两态，纯协议）。
 *
 * 每个用例用一次性账号（`createLockTestUser`）：锁屏状态 / 失败计数 / 退避都留在该账号上，
 * 结束后硬删 + 清锁缓存，不污染同一 worker 的后续用例。
 */

const LOCK_PWD = 'Lock-2e2-pass'
const WRONG_LOCK_PWD = 'Wrong-2e2-pass'
const WRONG_LOGIN_PWD = 'Wrong-2e2-login'

const PREFERENCE_API_PATH = `/api${SystemEndpointRoutes.USER_LOCK_PREFERENCE}`
const READ_API_PATH = `/api${SystemEndpointRoutes.USER_LOCK_READ}`
const UNLOCK_API_PATH = `/api${SystemEndpointRoutes.USER_LOCK_UNLOCK}`
const VERIFY_START_API_PATH = `/api${SystemEndpointRoutes.USER_LOCK_VERIFY_START}`
const VERIFY_FINISH_API_PATH = `/api${SystemEndpointRoutes.USER_LOCK_VERIFY_FINISH}`

interface ServerEnvelope<T = Record<string, unknown>> {
  code: number
  data: T
  msg?: string
  meta?: {
    failCount?: number
    retryAfterSec?: number
    [key: string]: unknown
  }
}

/** 登录态下的设置页：security 模式 + 锁屏密码 + 跨设备开关，并返回保存请求体 */
async function configureSecurityLock(page: Page, options: { lockPwd: string, crossDevice: boolean }): Promise<Record<string, unknown>> {
  // `Me` 菜单的真实路径是 `me/:tab?/:child_tab?`（useRouterParam 读 route.params，不是 query）
  await page.goto('/me/security/5')
  await expect(page.getByTestId('lock-settings')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('lock-mode-security').click()

  const securitySeconds = page.getByTestId('lock-security-seconds').locator('input')
  await securitySeconds.fill('60')
  await securitySeconds.press('Tab')

  // 一次性账号没有偏好行 ⇒ store 默认 lockCrossDevice=false；true 时点一次即可
  if (options.crossDevice) {
    await page.getByTestId('lock-cross-device').click()
  }

  await page.getByTestId('lock-pwd-set').fill(options.lockPwd)
  await page.getByTestId('lock-pwd-set-confirm').fill(options.lockPwd)

  const requestPromise = page.waitForRequest(request => request.method() === 'PATCH' && request.url().endsWith(PREFERENCE_API_PATH))
  const responsePromise = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(PREFERENCE_API_PATH))
  const readPromise = page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith(READ_API_PATH))

  await page.getByTestId('lock-settings-save').click()

  const [request, response] = await Promise.all([requestPromise, responsePromise])
  const body = await response.json() as ServerEnvelope<boolean>
  expect(body.code, `保存锁屏偏好失败：${body.msg ?? ''}`).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

  // 保存后 store.onInitLockState() 会重拉 read（L2 要求的「保存后重拉」）
  const refreshed = await readPromise
  const refreshedBody = await refreshed.json() as ServerEnvelope<{ lockPwdSet?: boolean }>
  expect(refreshedBody.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
  expect(refreshedBody.data.lockPwdSet, '保存后 read 应回 lockPwdSet=true').toBe(true)

  return JSON.parse(request.postData() ?? '{}') as Record<string, unknown>
}

/**
 * Q10 的机器证明：网络上的 `lockPwdHash` 必须是 AES-GCM 信封（base64 JSON 五字段），
 * 不是明文；密文里也不能出现明文口令。
 */
function expectCipherEnvelope(value: unknown, plaintext: string): void {
  expect(typeof value, 'preference 请求缺 lockPwdHash').toBe('string')
  const encoded = value as string

  expect(encoded).not.toContain(plaintext)

  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  const envelope = JSON.parse(decoded) as Record<string, unknown>

  expect(envelope.enc, '信封形态必须是 AES_256_GCM').toBe('AES_256_GCM')
  for (const key of ['key', 'iv', 'ct', 'tag'] as const) {
    expect(typeof envelope[key], `信封缺 ${key}`).toBe('string')
    expect((envelope[key] as string).length, `信封 ${key} 为空`).toBeGreaterThan(0)
  }

  const ciphertext = Buffer.from(envelope.ct as string, 'base64').toString('utf8')
  expect(ciphertext).not.toContain(plaintext)
}

/** 锁屏页容器 + 密码框都已出现 */
async function expectLockPage(page: Page): Promise<void> {
  await page.waitForURL(url => url.pathname === '/lock', { timeout: 20_000 })
  await expect(page.getByTestId('lock-page')).toBeVisible()
  await expect(page.getByTestId('lock-pwd-input')).toBeVisible()
}

/** 提交一次锁屏密码，返回业务响应壳 */
async function submitLockPwd(page: Page, pwd: string): Promise<ServerEnvelope<boolean>> {
  const responsePromise = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(UNLOCK_API_PATH))
  await page.getByTestId('lock-pwd-input').fill(pwd)
  await page.getByTestId('lock-unlock-submit').click()
  const response = await responsePromise
  return await response.json() as ServerEnvelope<boolean>
}

async function readDeviceLocked(userId: string, deviceId: string): Promise<boolean | null> {
  return withPg(async (pg) => {
    const row = await findUserDeviceRow(pg, userId, deviceId)
    return row?.locked ?? null
  })
}

async function readLockRow(userId: string) {
  return withPg(pg => findUserLockRow(pg, userId))
}

/**
 * 监听 socket.io 的服务端事件（UNLOCK 的机器证据）。
 *
 * 同时收两条腿：WebSocket 帧（升级完成后）与 `/socket/` 的 HTTP 长轮询响应
 * （engine.io 在 upgrade 之前 / 被代理挡住时会走 polling）。只按事件名包含判断，
 * 不解析 socket.io 协议细节 —— 这里要证明的是「服务端把 lock:unlock 发到了本浏览器」。
 */
function captureSocketFrames(page: Page): string[] {
  const frames: string[] = []

  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => {
      frames.push(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8'))
    })
  })

  page.on('response', (response) => {
    if (!response.url().includes('/socket/')) {
      return
    }
    void response.text().then((body) => {
      frames.push(body)
    }).catch(() => {})
  })

  return frames
}

test.describe('锁屏闭环 journey', { tag: '@journey' }, () => {
  test('J1 security 全流程：信封设置 → 密码框 → 5 次失败退避 → 退避期正确口令也拒 → 回填后解锁', async ({ browser }) => {
    const root = await rootClient()
    const { user, totpSecret, client: protocolDevice } = await createLockTestUser(root, 'e2e-lock-j1')

    // socket 帧监听必须在 login 之前挂：socket 在登录后的 getProfile 里建立，
    // 晚了只能看到「之后新开的」websocket，已连上的那条收不到 UNLOCK。
    const session = await openDevice(browser, '/auth')
    const page = session.page
    const socketFrames = captureSocketFrames(page)
    await loginViaUI(page, { userName: user.userName, password: user.password, totpSecret })
    session.deviceId = await resolveDeviceId(page)
    trackDevice(session.deviceId)

    const captured = captureEnvelopes(page)

    try {
      // 1. 设置 security + 锁屏密码 + 跨设备；网络层断言请求体是密文信封（Q10）
      const preferenceBody = await configureSecurityLock(page, { lockPwd: LOCK_PWD, crossDevice: true })
      expect(preferenceBody.lockMode).toBe('security')
      expect(preferenceBody.lockCrossDevice).toBe(true)
      expectCipherEnvelope(preferenceBody.lockPwdHash, LOCK_PWD)

      // 2. 触发锁屏 → /lock 的 security 密码框
      await page.getByTestId('lock-trigger').click()
      await expectLockPage(page)

      await expect.poll(() => readDeviceLocked(user.userId, session.deviceId), { timeout: 10_000 }).toBe(true)
      await expect.poll(() => withRedis(client => readLockCache(client, user.userId, 'global')), { timeout: 10_000 }).toBe(true)

      const lockRow = await readLockRow(user.userId)
      expect(lockRow?.lockMode).toBe('security')
      expect(lockRow?.lockPwdHash, '锁屏密码必须是 bcrypt 哈希，不能落明文').toMatch(/^\$2[aby]\$/)

      // 3. 前 4 次失败只计次（无 retryAfterSec），第 5 次起 30s 退避；全程停在 /lock（D4）
      for (let attempt = 1; attempt <= 4; attempt++) {
        const body = await submitLockPwd(page, WRONG_LOCK_PWD)
        expect(body.code, `第 ${attempt} 次错密码应回 40000`).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
        expect(body.meta?.retryAfterSec, `第 ${attempt} 次失败不应进入退避`).toBeUndefined()
        await expect(page.getByTestId('lock-unlock-error')).toBeVisible()
        expect(new URL(page.url()).pathname, 'D4：错密码后必须停在 /lock').toBe('/lock')
      }

      const afterFour = await readLockRow(user.userId)
      expect(afterFour?.lockPwdFailCount).toBe(4)

      const fifth = await submitLockPwd(page, WRONG_LOCK_PWD)
      expect(fifth.code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
      expect(fifth.meta?.failCount).toBe(5)
      expect(fifth.meta?.retryAfterSec, '第 5 次失败应给出 30s 档退避').toBeGreaterThanOrEqual(25)

      await expect(page.getByTestId('lock-retry-countdown')).toBeVisible()
      expect(new URL(page.url()).pathname).toBe('/lock')

      // 4. 退避期内**正确口令也被拒**（R-C O3：用真实语义断言替代 30s 硬等）。
      //    退避是用户级的、且先于密码比对（服务端 assertNotInUnlockBackoff），所以用同账号
      //    另一台已登录的协议设备提交正确锁屏密码 —— 40000 + retryAfterSec>0 才能证明
      //    「拒绝与密码对错无关」（反侧信道语义）；这条比「等 30s 再成功」更强。
      let backoffError: WalnutProtocolRequestError | null = null
      try {
        await unlockDevice(protocolDevice, LOCK_PWD)
      }
      catch (error) {
        if (error instanceof WalnutProtocolRequestError) {
          backoffError = error
        }
        else {
          throw error
        }
      }
      expect(backoffError, '退避期内正确锁屏密码不应解锁成功').not.toBeNull()
      expect(backoffError!.code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
      expect(backoffError!.meta?.retryAfterSec, '退避期拒绝必须带剩余秒数').toBeGreaterThan(0)

      // 5. 测试侧把退避截止回填到过去（+30s 裕量，消除 Node(Windows)/PG(WSL) 跨时钟竞速），
      //    再 reload 重置客户端倒计时；服务端设备锁态仍在 ⇒ 页面重新挂载后停在 /lock。
      await withPg(async (pg) => {
        expect(await expireLockBackoff(pg, user.userId), '回填应命中唯一的偏好行').toBe(1)
      })
      await page.reload()
      await expectLockPage(page)

      // 6. 正确密码 → 解锁 → 回原路由；socket UNLOCK 帧是广播腿的机器证据
      const successResponse = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(UNLOCK_API_PATH))
      await page.getByTestId('lock-pwd-input').fill(LOCK_PWD)
      await page.getByTestId('lock-unlock-submit').click()
      const successBody = await (await successResponse).json() as ServerEnvelope<boolean>
      expect(successBody.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

      await page.waitForURL(url => url.pathname !== '/lock', { timeout: 30_000 })
      await expect(page.getByTestId('lock-page')).toHaveCount(0)

      // socket 广播腿的断言放到最后（第 7 步的 default 免密解锁）：重新加载会重建 socket，
      // 而锁定态的 getProfile 被 40118 拦到解锁成功后才连上 —— 第一次解锁的 UNLOCK 帧必然
      // 错过，不是产品缺陷。恢复连接后的那一次解锁用同一事件证明广播腿。

      await expect.poll(() => readDeviceLocked(user.userId, session.deviceId), { timeout: 10_000 }).toBe(false)
      await expect.poll(() => withRedis(client => readLockCache(client, user.userId, 'global')), { timeout: 10_000 }).toBe(false)

      const afterUnlock = await readLockRow(user.userId)
      expect(afterUnlock?.lockPwdFailCount, '成功解锁应清零失败计数').toBe(0)
      expect(afterUnlock?.lockPwdLockedUntil, '成功解锁应清退避截止').toBeNull()

      // 也核一下 read 响应确实回来过（保存 / 解锁链路的 envelope 序列）
      await waitForEnvelope(captured.entries, entry => entry.url.includes(SystemEndpointRoutes.USER_LOCK_READ) && entry.code === WalnutAdminConstAppResponseCode.SUCCESS)

      // 7. default 模式：三态里的「免密按钮」腿（E1 的 lock-unlock-btn 必须被消费）
      // 先等 socket 恢复连接，再断言解锁广播（reload 后 socket 在解锁成功后的 getProfile 里重建）
      await waitForSocketConnected(socketFrames, 15_000)
      await expect(page.getByTestId('lock-settings')).toBeVisible()
      await page.getByTestId('lock-mode-default').click()

      const defaultSave = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(PREFERENCE_API_PATH))
      const defaultRead = page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith(READ_API_PATH))
      await page.getByTestId('lock-settings-save').click()
      expect((await (await defaultSave).json() as ServerEnvelope<boolean>).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      expect((await (await defaultRead).json() as ServerEnvelope<{ lockMode?: string }>).data.lockMode).toBe('default')

      await page.getByTestId('lock-trigger').click()
      await page.waitForURL(url => url.pathname === '/lock', { timeout: 20_000 })
      await expect(page.getByTestId('lock-unlock-btn')).toBeVisible()

      const freeUnlock = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(UNLOCK_API_PATH))
      await page.getByTestId('lock-unlock-btn').click()
      expect((await (await freeUnlock).json() as ServerEnvelope<boolean>).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      await page.waitForURL(url => url.pathname !== '/lock', { timeout: 30_000 })
      await expect.poll(
        () => socketFrames.some(frame => frame.includes('lock:unlock')),
        { timeout: 15_000, message: '浏览器 socket 没有收到 UNLOCK 帧' },
      ).toBe(true)
      await expect.poll(() => readDeviceLocked(user.userId, session.deviceId), { timeout: 10_000 }).toBe(false)
    }
    finally {
      captured.stop()
      await session.context.close()
      await deleteLoginableUser(user)
      await withRedis(client => deleteUserLockCache(client, user.userId))
    }
  })

  test('J2 忘记锁屏密码：口令错客户端即失败；40115 到 /mfa-verified（D3）；正确口令解锁', async ({ browser }) => {
    const root = await rootClient()
    const { user, totpSecret } = await createLockTestUser(root, 'e2e-lock-j2')
    const session = await openLoggedInDevice(browser, user, totpSecret)
    const page = session.page
    let verifyFinishRequests = 0

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith(VERIFY_FINISH_API_PATH)) {
        verifyFinishRequests += 1
      }
    })

    try {
      await configureSecurityLock(page, { lockPwd: LOCK_PWD, crossDevice: false })

      await page.getByTestId('lock-trigger').click()
      await expectLockPage(page)

      await page.getByTestId('lock-forgot-link').click()
      await expect(page.getByTestId('lock-fallback-panel')).toBeVisible()
      await expect(page.getByTestId('lock-fallback-hint')).toBeVisible()

      // 1. 错误登录口令：OPAQUE 在客户端就失败，verify/finish 一次都不发，服务端计不到次
      const wrongStart = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(VERIFY_START_API_PATH))
      await page.getByTestId('lock-fallback-input').fill(WRONG_LOGIN_PWD)
      await page.getByTestId('lock-fallback-submit').click()
      const wrongStartBody = await (await wrongStart).json() as ServerEnvelope<string>
      expect(wrongStartBody.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

      await expect(page.getByTestId('lock-fallback-error')).toBeVisible()
      expect(verifyFinishRequests, '口令错时不应调用 verify/finish（服务端计不到次）').toBe(0)

      const afterWrongLoginPwd = await readLockRow(user.userId)
      expect(afterWrongLoginPwd?.lockPwdFailCount).toBe(0)

      await page.getByTestId('lock-fallback-back').click()
      await expect(page.getByTestId('lock-pwd-input')).toBeVisible()
      await page.getByTestId('lock-forgot-link').click()

      // 2. D3：删掉设备级 MFA 已验证缓存 → verify/start 40115 → 锁屏守卫必须放行 /mfa-verified
      await withRedis(client => deleteMfaVerifiedCache(client, user.userId, session.deviceId))

      const mfaStartResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(VERIFY_START_API_PATH))
      await page.getByTestId('lock-fallback-input').fill(user.password)
      await page.getByTestId('lock-fallback-submit').click()

      const mfaStartBody = await (await mfaStartResponse).json() as ServerEnvelope<string>
      expect(mfaStartBody.code, '本设备未完成 MFA 时应 40115').toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED)

      await page.waitForURL(url => url.pathname === '/mfa-verified', { timeout: 20_000 })
      expect(await verifyMfaIfPresent(page, totpSecret), '应完成 /mfa-verified 的 TOTP').toBe(true)

      // 验证完成后仍处于锁定态（40118），守卫把用户送回 /lock
      await page.waitForURL(url => url.pathname === '/lock', { timeout: 20_000 })
      await expect(page.getByTestId('lock-pwd-input')).toBeVisible()

      // 3. 再次走 fallback：这次 OPAQUE verify start/finish 全通，服务端就地解锁
      await page.getByTestId('lock-forgot-link').click()
      await expect(page.getByTestId('lock-fallback-panel')).toBeVisible()

      const correctStart = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(VERIFY_START_API_PATH))
      const correctFinish = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(VERIFY_FINISH_API_PATH))
      await page.getByTestId('lock-fallback-input').fill(user.password)
      await page.getByTestId('lock-fallback-submit').click()

      const correctStartBody = await (await correctStart).json() as ServerEnvelope<string>
      const correctFinishBody = await (await correctFinish).json() as ServerEnvelope<boolean>
      expect(correctStartBody.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      expect(correctFinishBody.code, 'fallback 验证通过应就地解锁').toBe(WalnutAdminConstAppResponseCode.SUCCESS)

      await page.waitForURL(url => url.pathname !== '/lock', { timeout: 30_000 })

      await expect.poll(() => readDeviceLocked(user.userId, session.deviceId), { timeout: 10_000 }).toBe(false)
      await expect.poll(() => withRedis(client => readLockCache(client, user.userId, session.deviceId)), { timeout: 10_000 }).toBe(false)

      const afterUnlock = await readLockRow(user.userId)
      expect(afterUnlock?.lockPwdFailCount).toBe(0)
      expect(afterUnlock?.lockPwdLockedUntil).toBeNull()
    }
    finally {
      await session.context.close()
      await deleteLoginableUser(user)
      await withRedis(client => deleteUserLockCache(client, user.userId))
    }
  })

  test('J3 root 在用户管理行内重置被锁用户 → 设备锁态解除 + 审计行', async ({ browser }) => {
    const root = await rootClient()
    const { user, client: victim } = await createLockTestUser(root, 'e2e-lock-j3')

    const session = await openDevice(browser, '/auth')
    const page = session.page

    try {
      await setLockPreference(victim, securityLockPreference(LOCK_PWD, { lockCrossDevice: false }))
      await lockDevice(victim)
      await expect.poll(() => readDeviceLocked(user.userId, victim.deviceId), { timeout: 10_000 }).toBe(true)

      await loginViaUI(page)
      const adminDeviceId = await resolveDeviceId(page)
      trackDevice(adminDeviceId)

      // 已挂载的应用内导航（整页 reload 会重新走 bootstrap，列表可能在权限就绪前发请求）
      await navigateInApp(page, '/system/user')
      await expect(page.getByTestId('user-list-table')).toBeVisible({ timeout: 30_000 })

      // 查询表单第一个 input 是 userName（schema 顺序：userName → nickName）
      const queryInput = page.getByTestId('table-query-form').locator('input').first()
      await queryInput.fill(user.userName)
      const listResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/system/user/list'))
      await page.getByTestId('table-query-search').click()
      const listBody = await (await listResponse).json() as ServerEnvelope<{ total: number }>
      expect(listBody.code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

      const row = page.locator('tbody tr').filter({ hasText: user.userName }).first()
      await expect(row, `用户列表没有 ${user.userName} 行`).toBeVisible({ timeout: 20_000 })

      const resetResponse = page.waitForResponse(
        response => response.request().method() === 'PUT' && response.url().endsWith(`/api${SystemEndpointRoutes.USER_LOCK_RESET}/${user.userId}`),
      )
      await row.getByTestId('user-reset-lock-btn').click()

      // WIconButton 的 confirm 是 n-popconfirm；positive 按钮是 primary。
      // force 跳过「可点性」等待：弹层的过渡/遮罩判定在多行操作列上偶发超时，
      // 本用例要验的是重置链路，不是 popconfirm 的命中测试。
      await page.getByRole('button', { name: '确认' }).click({ force: true, timeout: 10_000 })

      const resetBody = await (await resetResponse).json() as ServerEnvelope<boolean>
      expect(resetBody.code, `重置锁屏失败：${resetBody.msg ?? ''}`).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

      await expect.poll(() => readDeviceLocked(user.userId, victim.deviceId), { timeout: 10_000 }).toBe(false)

      const auditRows = await withPg(pg => countLockResetAuditRows(pg, user.userId))
      expect(auditRows, 'sys_log_operate 应留下 user.lock.reset 审计行').toBeGreaterThan(0)
    }
    finally {
      await session.context.close()
      await deleteLoginableUser(user)
      await withRedis(client => deleteUserLockCache(client, user.userId))
    }
  })

  test('J4 登录即解锁：lockCrossDevice=true 全解 / false 只解本台（两态都钉）', async () => {
    const root = await rootClient()
    const { user, totpSecret, client: deviceA } = await createLockTestUser(root, 'e2e-lock-j4')

    try {
      // 态 1：跨设备锁定 → 第二台设备完整登录解锁全部设备
      await setLockPreference(deviceA, securityLockPreference(LOCK_PWD, { lockCrossDevice: true }))
      await lockDevice(deviceA)
      await expect.poll(() => readDeviceLocked(user.userId, deviceA.deviceId), { timeout: 10_000 }).toBe(true)
      await expect.poll(() => withRedis(client => readLockCache(client, user.userId, 'global')), { timeout: 10_000 }).toBe(true)

      const deviceB = await loginVerifiedDevice(user, totpSecret)
      await expect.poll(() => readDeviceLocked(user.userId, deviceA.deviceId), { timeout: 10_000 }).toBe(false)
      expect(await readDeviceLocked(user.userId, deviceB.deviceId)).toBe(false)
      await expect.poll(() => withRedis(client => readLockCache(client, user.userId, 'global')), { timeout: 10_000 }).toBe(false)

      // 态 2：切回单设备 → 第二台（第三台）设备登录不解锁 deviceA
      await setLockPreference(deviceA, securityLockPreference(LOCK_PWD, { lockCrossDevice: false }))
      await lockDevice(deviceA)
      await expect.poll(() => readDeviceLocked(user.userId, deviceA.deviceId), { timeout: 10_000 }).toBe(true)
      await expect.poll(() => withRedis(client => readLockCache(client, user.userId, deviceA.deviceId)), { timeout: 10_000 }).toBe(true)

      const deviceC = await loginVerifiedDevice(user, totpSecret)
      expect(await readDeviceLocked(user.userId, deviceA.deviceId), '单设备偏好下，别台登录不得解锁 deviceA').toBe(true)
      expect(await readDeviceLocked(user.userId, deviceC.deviceId)).toBe(false)

      // 收尾：deviceA 自己用锁屏密码解锁（不让残留锁定态进入下一轮）
      await unlockDevice(deviceA, LOCK_PWD)
      await expect.poll(() => readDeviceLocked(user.userId, deviceA.deviceId), { timeout: 10_000 }).toBe(false)
    }
    finally {
      await deleteLoginableUser(user)
      await withRedis(client => deleteUserLockCache(client, user.userId))
    }
  })
})

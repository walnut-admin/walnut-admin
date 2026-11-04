import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { AppTechCacheVerifyCodeService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { SysUserIdentitySharedService } from '@walnut-server/identity'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { overrideAppSettings } from '../../helpers/app-settings'
import { registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'

/**
 * D 段：`auth/otp`（email 通道，真实 HTTP 全链）：
 *
 * - 默认现场（app_setting 空表 → OtpSettingService 走缺省配置 authEnable=0/sendEnable=0）：
 *   send → OtpSendFunctionalGuard 50300 EndPointUnavailable，verify → OtpFunctionalGuard
 *   同码 —— 「sendEnable=0 不真发邮件」的受控返回；
 * - 种 APP:SETTING 缓存开 email 功能（用例自管缓存，afterAll 还原）后：
 *   send → 20000 true，验证码落 `AUTH:VERIFY_CODE:visitor:<identifier>`（邮件任务进
 *   Bull 队列，测试环境无 worker 不真发 —— C 段 user-identity 同口径），从真实缓存
 *   通道读回真码；
 * - verify 走 OtpGuard（passport-local → OtpStrategy）：错码 40000 verifyCodeError；
 *   对码换发令牌（20000 + accessToken/sessionKey + RT_JTI cookie）+ identity 标记
 *   verified + 验证码缓存删除（authWithOtp finally）。
 *
 * verify 换发的 RT 走新建行分支（专用客户端全程未登录，无同设备旧行）。
 * controller 是 JwtFree+Sign 生效：登录态客户端 anon() 签双因子会被 40112 拦 ——
 * 闭环请求一律发在本轮未登录的独立客户端上。
 */

const OTP_EMAIL_SETTING_KEY = 'app.auth.email'

describe('D 段：auth/otp send+verify（functional 开关 + OtpGuard 真实闭环）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  /** OTP 专用匿名客户端（JwtFree 路由 + Sign 生效 —— 登录态 jar 会污染单因子签名） */
  let anonClient: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  const identifier = `otp-${seed8}@example.com`
  let fixture: WalnutRootUserFixture | null = null
  let verifyCodeService: AppTechCacheVerifyCodeService
  let restoreSettings: (() => Promise<void>) | null = null

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    anonClient = await WalnutApiClient.create(app)
    verifyCodeService = app.get(AppTechCacheVerifyCodeService)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `otp-${seed8}`)

    // 目标 email 身份（login purpose，服务级造 —— 走真实加密/hash 通道）：
    // OtpGuard 的 validateIdentity 按 valueHash 命中 fixture 用户（不发新用户）
    await app.get(SysUserIdentitySharedService).createIdentity(fixture.userId, 'emailAddress', 'login', identifier)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      if (restoreSettings !== null) {
        await restoreSettings()
      }
      // 闭环换发把验证码/会话/MFA 键清干净（visitor 码缓存键带 identifier 片段）
      await verifyCodeService.delVerifyCodeForVisitorCache(identifier)
      await api.pgDataSource.query('DELETE FROM sys_user_identity WHERE user_id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [[api.deviceId, anonClient.deviceId]])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, anonClient.deviceId, fixture.userId, identifier)
    }
    await app.close()
  })

  it('缺省配置（sendEnable=0）：send → 50301 EndPointUnavailable，验证码缓存不落', async () => {
    const res = await anonClient.anon('POST', anonClient.apiPath('/auth/otp/send'), {
      type: 'email',
      identifier,
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_ENDPOINT_DOWN)
    expect(await verifyCodeService.getVerifyCodeForVisitorCache(identifier)).toBeNull()
  })

  it('type 非法 → 40099（functional guard 对无效 type 放行，ValidationPipe IsEnum 收口）', async () => {
    const res = await anonClient.anon('POST', anonClient.apiPath('/auth/otp/send'), {
      type: 'fax',
      identifier,
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('开 email 功能后：send → 20000 true，真码落 AUTH:VERIFY_CODE visitor 缓存', async () => {
    restoreSettings = await overrideAppSettings(app, {
      [OTP_EMAIL_SETTING_KEY]: JSON.stringify({
        authEnable: 1,
        sendEnable: 1,
        verifyFigure: 6,
        verifyTtl: 300,
        sendLimit: 5,
        sendTtl: 600,
      }),
    })

    const res = await anonClient.anon('POST', anonClient.apiPath('/auth/otp/send'), {
      type: 'email',
      identifier,
    })
    expectOk(res, 'otp send')
    expect(bodyOf<boolean>(res).data).toBe(true)

    const code = await verifyCodeService.getVerifyCodeForVisitorCache(identifier)
    expect(code).not.toBeNull()
    expect(String(code)).toMatch(/^\d{6}$/)
  })

  it('P1-16：send 动态限流真实生效（sendLimit=2 / sendTtl=600）—— 前两次 20000、第三次 42900 且 Retry-After 反映动态 blockDuration', async () => {
    // 还原上一用例的 sendLimit=5，改用 2 次窗口（tracker = identifier:ip，换 identifier 清零）
    await restoreSettings!()
    restoreSettings = await overrideAppSettings(app, {
      [OTP_EMAIL_SETTING_KEY]: JSON.stringify({
        authEnable: 1,
        sendEnable: 1,
        verifyFigure: 6,
        verifyTtl: 300,
        sendLimit: 2,
        sendTtl: 600,
      }),
    })

    const limitedIdentifier = `otp-limit-${seed8}@example.com`

    for (let i = 0; i < 2; i++) {
      const res = await anonClient.anon('POST', anonClient.apiPath('/auth/otp/send'), {
        type: 'email',
        identifier: limitedIdentifier,
      })
      expectOk(res, `otp send #${i + 1} under dynamic limit`)
    }

    const third = await anonClient.anon('POST', anonClient.apiPath('/auth/otp/send'), {
      type: 'email',
      identifier: limitedIdentifier,
    })
    expect(third.status).toBe(200)
    expect(bodyOf(third).code).toBe(WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS)

    // 动态 sendTtl=600s 同步进 blockDuration —— 修复前元数据键错位时这里走全局 10s 窗口，
    // 且 blockDuration 仍是全局 ttl；断言 ≥30s 区分两态。
    const retryAfter = Number(third.headers['retry-after'])
    expect(Number.isFinite(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(30)
  })

  it('verify 错码 → 40000 verifyCodeError（OtpGuard passport 链上抛）', async () => {
    const res = await anonClient.anon('POST', anonClient.apiPath('/auth/otp/verify'), {
      type: 'email',
      identifier,
      verifyCode: '000000',
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('verify 对码 → 20000 换发令牌 + RT_JTI cookie + identity 标记 verified + 码缓存删除', async () => {
    // anonClient 全程未登录 → 无 RT 行，verify 的 generateRefreshToken 走新建行分支
    const code = String(await verifyCodeService.getVerifyCodeForVisitorCache(identifier))
    expect(code).toMatch(/^\d{6}$/)

    const res = await anonClient.anon('POST', anonClient.apiPath('/auth/otp/verify'), {
      type: 'email',
      identifier,
      verifyCode: code,
    })
    expectOk(res, 'otp verify')
    const data = bodyOf<{ accessToken: string, sessionKey: string }>(res).data
    expect(typeof data.accessToken).toBe('string')
    expect(typeof data.sessionKey).toBe('string')
    const setCookies = res.headers['set-cookie'] as unknown as string[] | undefined
    expect(setCookies?.some(raw => raw.startsWith('__Host-RT_JTI='))).toBe(true)

    // identity（emailAddress/login，由 OtpGuard validateIdentity 按 valueHash 命中 fixture 用户）标记 verified
    const identityRows: Array<{ verified: boolean }> = await api.pgDataSource.query(
      'SELECT verified FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'login'],
    )
    expect(identityRows).toHaveLength(1)
    expect(identityRows[0].verified).toBe(true)

    // 码被消费删除（authWithOtp finally）
    expect(await verifyCodeService.getVerifyCodeForVisitorCache(identifier)).toBeNull()

    // 换发的会话真实落键：AUTH:SESSIONS:<userId>:<deviceId>:<sid>（createAuthSession 痕迹）
    const sid = JSON.parse(Buffer.from(data.accessToken.split('.')[1], 'base64url').toString('utf8')) as { sid?: string }
    expect(typeof sid.sid).toBe('string')
    expect(await anonClient.hasWalnutCacheKey(
      `${WalnutAdminConstAppCacheKeys.AUTH_SESSIONS}:${fixture!.userId}:${anonClient.deviceId}:${sid.sid}`,
    )).toBe(true)

    // 换发的令牌真实可用：新 sessionKey 派生双因子签名过 Sign guard（挑一条与菜单表
    // 无关的登录态端点 —— permissions 在空菜单表上 50000，见 auth-session spec 头注）
    anonClient.setAuth({ userId: fixture!.userId, userName: fixture!.userName, accessToken: data.accessToken, sessionKey: data.sessionKey })
    await anonClient.seedMfaVerifiedCache(fixture!.userId)
    const probe = await anonClient.root('GET', anonClient.apiPath('/system/user/me/security-tab2'))
    expectOk(probe, 'security-tab2 with otp-issued session')
  })
})

import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { OAuthStateService } from '@walnut-server/auth'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { overrideAppSettings } from './helpers/app-settings'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * D 段：`auth` 外部 OAuth 三系（google fed_cm / gitee / github）—— **错误路径专项**
 * （真实 OAuth 回调依赖外部 IdP，不进回归）：
 *
 * - functional 开关关闭态（APP:SETTING 显式种 authEnable:0）：POST /auth/google、
 *   GET /auth/oauth/{gitee,github}/url → 50300 EndPointUnavailable（class 级 functional
 *   guard 在 passport guard 之前拦死）；
 * - P1-17（2026-10-28）：Google 端点 defaultClosed —— APP:SETTING 零配置（缓存缺失）时
 *   POST /auth/google 直接 50301（gitee/github 保持缺省放行）；开启态（authEnable=1）
 *   才进入本地 JWKS 校验腿；
 * - 开启态：gitee/github `/url` 端点 → 构造出的跳转 URL（authorize 地址 + client_id +
 *   redirect_uri + response_type + scope + 签名 state）；
 * - P2-13（2026-10-28）：state 不再是明文 JSON —— `base64url(JSON{lang,nonce})` +
 *   `.` + HMAC-SHA256 签名；callback 在换 code 前验签 + 绑 deviceId + Redis DEL 一次性
 *   消费（篡改 / 重放 / 跨设备一律受控 40000）。合法 state 的签发-消费闭环在 service
 *   层直测（真实 callback 需要外部 IdP，不进回归）；批次6-B 起明文段不再带客户端
 *   指纹（fp 全仓无消费方，已移除），deviceId 只落 Redis、不进 URL；
 * - 开启态：POST /auth/google 带 garbage credential → 本地 JWKS 校验失败 → 40107
 *   （不发外网）；
 * - callback 缺 code：P3-3 修复后（2026-10-28）guard 前置校验 → 受控 40000（HTTP 200
 *   统一壳），不再走 passport-oauth2 的 302 authorize 重定向腿；
 *
 * 全部端点 JwtFree（部分 SignFree）：登录态 jar 会污染单因子签名 —— 断言一律发在
 * 未登录的独立客户端上。
 */

const GITEE_AUTHORIZE_URL = 'https://gitee.com/oauth/authorize'
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'

describe('D 段：外部 OAuth 错误路径专项 google/gitee/github（真实 HTTP 全链，外部 IdP 不进回归）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  /** OAuth 断言专用未登录客户端（这些端点全部 JwtFree） */
  let anonClient: WalnutApiClient
  /** 第二设备：跨设备重放 / CSRF 的设备绑定断言用 */
  let otherClient: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  let restoreSettings: (() => Promise<void>) | null = null

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    anonClient = await WalnutApiClient.create(app)
    otherClient = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `oauth-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      if (restoreSettings !== null) {
        await restoreSettings()
      }
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [[api.deviceId, anonClient.deviceId, otherClient.deviceId]])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, anonClient.deviceId, otherClient.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('P1-17 零配置默认关闭：APP:SETTING 无 app.auth.google → POST /auth/google 50301（functional guard defaultClosed）', async () => {
    // 不写任何 settings：通用 functional 口径是缺省放行，Google 控制器用 defaultClosed
    // 显式要求 authEnable=1 —— 缺失即 EndPointUnavailable，先于 passport/JWKS 校验。
    const res = await anonClient.anon('POST', anonClient.apiPath('/auth/google'), { credential: 'garbage' })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_ENDPOINT_DOWN)
  })

  it('functional 关闭态：google/gitee/github 三系入口全被 50301 拦在 passport guard 之前', async () => {
    restoreSettings = await overrideAppSettings(app, {
      'app.auth.google': JSON.stringify({ authEnable: 0, newUserSignup: 0 }),
      'app.auth.gitee': JSON.stringify({ authEnable: 0, newUserSignup: 0 }),
      'app.auth.github': JSON.stringify({ authEnable: 0, newUserSignup: 0 }),
    })

    const googleRes = await anonClient.anon('POST', anonClient.apiPath('/auth/google'), { credential: 'garbage' })
    expect(bodyOf(googleRes).code).toBe(WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_ENDPOINT_DOWN)

    const giteeUrlRes = await anonClient.anon('GET', anonClient.apiPath('/auth/oauth/gitee/url'))
    expect(bodyOf(giteeUrlRes).code).toBe(WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_ENDPOINT_DOWN)

    const githubUrlRes = await anonClient.anon('GET', anonClient.apiPath('/auth/oauth/github/url'))
    expect(bodyOf(githubUrlRes).code).toBe(WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_ENDPOINT_DOWN)
  })

  it('开启态 gitee /url → 构造跳转 URL（authorize + client_id + redirect_uri + scope + state JSON）', async () => {
    await restoreSettings!()
    restoreSettings = await overrideAppSettings(app, {
      'app.auth.gitee': JSON.stringify({ authEnable: 1 }),
    })

    const res = await anonClient.anon('GET', anonClient.apiPath('/auth/oauth/gitee/url'))
    expectOk(res, 'gitee oauth url')
    const url = bodyOf<string>(res).data

    const clientId = app.get(ConfigService).get<string>('auth.gitee.clientId')
    const callbackURL = app.get(ConfigService).get<string>('auth.gitee.callbackURL')
    expect(url).toContain(`${GITEE_AUTHORIZE_URL}?client_id=${clientId}`)
    // redirect_uri 原样拼接不做 URL 转义（钉现状：无 & 的回调地址才可幸存）
    expect(url).toContain(`redirect_uri=${callbackURL}`)
    expect(url).toContain('response_type=code')
    expect(url).toContain('scope=user_info%20emails')

    // P2-13：state = base64url(JSON{lang,nonce}) + '.' + HMAC 签名（不再是明文 JSON）
    // 批次6-B：明文段只剩 lang / nonce —— 客户端指纹已移除，deviceId 只落 Redis 不外发
    const stateRaw = url.split('&state=')[1]
    expect(stateRaw).toBeTruthy()
    expect(stateRaw.startsWith('{')).toBe(false)
    const [encodedPayload, signature] = stateRaw.split('.')
    expect(encodedPayload).toBeTruthy()
    expect(signature).toBeTruthy()
    const state = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as { lang?: string, nonce?: string }
    expect(Object.keys(state).sort()).toEqual(['lang', 'nonce'])
    expect(typeof state.lang).toBe('string')
    // nonce 一次性凭据：32 位 hex
    expect(state.nonce).toMatch(/^[0-9a-f]{32}$/)
    // 设备绑定值不外发（URL 会交给第三方 IdP 与沿途日志）：state 任何一段都不含 deviceId
    expect(stateRaw).not.toContain(anonClient.deviceId)
  })

  it('开启态 github /url → 同构跳转 URL（scope=read:user user:email）', async () => {
    await restoreSettings!()
    restoreSettings = await overrideAppSettings(app, {
      'app.auth.github': JSON.stringify({ authEnable: 1 }),
    })

    const res = await anonClient.anon('GET', anonClient.apiPath('/auth/oauth/github/url'))
    expectOk(res, 'github oauth url')
    const url = bodyOf<string>(res).data

    const clientId = app.get(ConfigService).get<string>('auth.github.clientId')
    expect(url).toContain(`${GITHUB_AUTHORIZE_URL}?client_id=${clientId}`)
    expect(url).toContain('response_type=code')
    expect(url).toContain('scope=read:user%20user:email')

    const stateRaw = url.split('&state=')[1]
    expect(stateRaw).toBeTruthy()
    const [encodedPayload, signature] = stateRaw.split('.')
    expect(encodedPayload).toBeTruthy()
    expect(signature).toBeTruthy()
    const state = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as { lang?: string, nonce?: string }
    expect(Object.keys(state).sort()).toEqual(['lang', 'nonce'])
    expect(state.nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(stateRaw).not.toContain(anonClient.deviceId)
  })

  it('P2-13 合法 state 签发-消费闭环：service 层一次成功、二次重放返回 null', async () => {
    const service = app.get(OAuthStateService)
    const state = await service.issueState('zh_CN', anonClient.deviceId)

    const first = await service.consumeState(state, anonClient.deviceId)
    // 批次6-B：消费结果带回 state 绑定的 deviceId（回调侧据此推导投递频道）
    expect(first?.deviceId).toBe(anonClient.deviceId)
    expect(first?.lang).toBe('zh_CN')

    // 同一 state 第二次消费 → null（Redis DEL 计数只有一次 = 1）
    expect(await service.consumeState(state, anonClient.deviceId)).toBeNull()
  })

  it('F5：oauth state 服务显式拒绝空 deviceId（不依赖 null == null 的伪绑定）', async () => {
    const service = app.get(OAuthStateService)

    await expect(service.issueState('zh_CN', '')).rejects.toBeTruthy()

    // 空 deviceId 消费一律拒绝（即使 state 本身合法）
    const state = await service.issueState('zh_CN', anonClient.deviceId)
    expect(await service.consumeState(state, '')).toBeNull()
  })

  it('P2-13 篡改 state 签名 → callback 受控 40000（不进入 token 交换）', async () => {
    await restoreSettings!()
    restoreSettings = await overrideAppSettings(app, {
      'app.auth.gitee': JSON.stringify({ authEnable: 1 }),
    })

    const urlRes = await anonClient.anon('GET', anonClient.apiPath('/auth/oauth/gitee/url'))
    const stateRaw = bodyOf<string>(urlRes).data.split('&state=')[1]
    const last = stateRaw.slice(-1)
    const tampered = `${stateRaw.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`

    const res = await anonClient.anon(
      'GET',
      anonClient.apiPath(`/auth/oauth/gitee/callback?code=fake-code&state=${tampered}`),
    )
    expect(res.status).toBe(200)
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect(res.headers.location).toBeUndefined()

    // 篡改被拒不影响原始 state（验签失败在消费之前）
    const service = app.get(OAuthStateService)
    expect(await service.consumeState(stateRaw, anonClient.deviceId)).not.toBeNull()
  })

  it('P2-13 重放已消费 state → callback 受控 40000', async () => {
    await restoreSettings!()
    restoreSettings = await overrideAppSettings(app, {
      'app.auth.gitee': JSON.stringify({ authEnable: 1 }),
    })

    const urlRes = await anonClient.anon('GET', anonClient.apiPath('/auth/oauth/gitee/url'))
    const stateRaw = bodyOf<string>(urlRes).data.split('&state=')[1]

    // 模拟合法 callback 已消费过该 state
    const service = app.get(OAuthStateService)
    expect(await service.consumeState(stateRaw, anonClient.deviceId)).not.toBeNull()

    const res = await anonClient.anon(
      'GET',
      anonClient.apiPath(`/auth/oauth/gitee/callback?code=fake-code&state=${stateRaw}`),
    )
    expect(res.status).toBe(200)
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('P2-13 跨设备完成授权（登录 CSRF）→ callback 受控 40000', async () => {
    await restoreSettings!()
    restoreSettings = await overrideAppSettings(app, {
      'app.auth.gitee': JSON.stringify({ authEnable: 1 }),
    })

    // 攻击者设备发起 /url 拿 state，受害者设备打开 callback → deviceId 不匹配
    const urlRes = await anonClient.anon('GET', anonClient.apiPath('/auth/oauth/gitee/url'))
    const stateRaw = bodyOf<string>(urlRes).data.split('&state=')[1]

    const res = await otherClient.anon(
      'GET',
      otherClient.apiPath(`/auth/oauth/gitee/callback?code=fake-code&state=${stateRaw}`),
    )
    expect(res.status).toBe(200)
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('P2-13 github 同构：篡改 state → 受控 40000', async () => {
    await restoreSettings!()
    restoreSettings = await overrideAppSettings(app, {
      'app.auth.github': JSON.stringify({ authEnable: 1 }),
    })

    const urlRes = await anonClient.anon('GET', anonClient.apiPath('/auth/oauth/github/url'))
    const stateRaw = bodyOf<string>(urlRes).data.split('&state=')[1]
    const last = stateRaw.slice(-1)
    const tampered = `${stateRaw.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`

    const res = await anonClient.anon(
      'GET',
      anonClient.apiPath(`/auth/oauth/github/callback?code=fake-code&state=${tampered}`),
    )
    expect(res.status).toBe(200)
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('开启态 google fed_cm：garbage credential → 40107（本地 JWKS 校验失败，不发外网）', async () => {
    await restoreSettings!()
    restoreSettings = await overrideAppSettings(app, {
      'app.auth.google': JSON.stringify({ authEnable: 1 }),
    })

    const res = await anonClient.anon('POST', anonClient.apiPath('/auth/google'), {
      credential: `not-a-jwt-${seed8}`,
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_OAUTH_FAILED)
  })

  it('callback 缺 code：gitee → 受控 40000（P3-3：guard 前置校验，不再 302）', async () => {
    await restoreSettings!()
    restoreSettings = await overrideAppSettings(app, {
      'app.auth.gitee': JSON.stringify({ authEnable: 1 }),
    })

    const res = await anonClient.anon('GET', anonClient.apiPath('/auth/oauth/gitee/callback'))
    expect(res.status).toBe(200)
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect(res.headers.location).toBeUndefined()
  })

  it('callback 缺 code：github → 同构受控 40000', async () => {
    await restoreSettings!()
    restoreSettings = await overrideAppSettings(app, {
      'app.auth.github': JSON.stringify({ authEnable: 1 }),
    })

    const res = await anonClient.anon('GET', anonClient.apiPath('/auth/oauth/github/callback'))
    expect(res.status).toBe(200)
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect(res.headers.location).toBeUndefined()
  })
})

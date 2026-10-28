import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
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
 *   redirect_uri + response_type + scope + state JSON{fp,lang}）；POST /auth/google 带
 *   garbage credential → 本地 JWKS 校验失败 → 40107（不发外网）；
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

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  let restoreSettings: (() => Promise<void>) | null = null

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    anonClient = await WalnutApiClient.create(app)

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
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [[api.deviceId, anonClient.deviceId]])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, anonClient.deviceId, fixture.userId)
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

    // state 是 JSON.stringify({fp, lang})（未做 URL 转义，原样拼在尾部）
    const stateRaw = url.split('&state=')[1]
    expect(stateRaw).toBeTruthy()
    const state = JSON.parse(stateRaw) as { fp?: string, lang?: string }
    expect(typeof state.fp).toBe('string')
    expect((state.fp as string).length).toBeGreaterThan(0)
    expect(typeof state.lang).toBe('string')
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
    const state = JSON.parse(stateRaw) as { fp?: string }
    expect(typeof state.fp).toBe('string')
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

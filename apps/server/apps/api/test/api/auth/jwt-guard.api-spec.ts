import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import type { WalnutRootUserFixture } from '../helpers/auth-login'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../helpers/auth-login'
import { createApiApp } from '../helpers/create-api-app'

/**
 * JWT 守卫的「Optional / Free / 轮换」三块边界（真实 HTTP 全链）。
 *
 * 1. **JwtOptional + 坏 AT ⇒ 降级为匿名**（`jwt-access.guard.ts:62-67`）：
 *    此前 `user-preference.api-spec.ts:55` 只测了「不带 AT」。这里补「带了但坏」的两形态
 *    （非 JWT 串 / 签名错）与「过期」，判据取**看得到差异**的那种：先把该用户偏好改成
 *    `en_US`，匿名默认是 `zh_CN` —— 坏 AT 若被当成登录态，读到的是 en_US（会红）；
 *    真降级则读到 zh_CN，且与「完全不带 AT」的响应逐字段相等。
 * 2. **JwtFree + 坏 AT ⇒ 完全忽略**：`/system/lang/list/public` 是 JwtFree（Sign/Device/
 *    Cap/Lock 全 Free），带坏 AT 必须与匿名同一份数据；同一枚坏 AT 打受保护端点是 40101
 *    （正对照 —— 证明「坏」是真的坏，不是被解析成了别的身份）。
 * 3. **RT 轮换后的凭据面**：新 AT 可用；**旧 AT 仍可用**（轮换只换令牌不换会话，sid 不变 ——
 *    与 `auth-session.api-spec.ts:263` 的实现口径一致，这里从 AT 侧对称印证）；真正作废的
 *    是**旧 RT**（旧 jti 行被撤销 ⇒ 40102）。任务书里「轮换后旧 AT 失效」的前提与实现不符，
 *    本文件按实现钉现状：最后两条用例把「失效的是 RT、不是 AT」双向钉住。
 */

interface IPreferenceShape {
  basic: { locale: string }
}

/** AT 的有效期与 sid 只读解码（不验签，测试侧定位会话） */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payloadPart = token.split('.')[1]
  return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('JWT 守卫：Optional / Free / RT 轮换（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  /** 受保护端点（无 permission 元数据 ⇒ permission guard 放行；MFA 闸门已由 verified 缓存满足） */
  const PROTECTED_PATH = '/system/user/me/profile'
  const PREFERENCE_READ = '/system/user/preference/read'
  const LANG_PUBLIC = '/system/lang/list/public'

  let accessSecret = ''
  /** 登录态下的正常 AT（各用例的基准） */
  let validAt = ''
  /** 完全不带 AT 的匿名偏好响应（坏/过期 AT 的响应必须与它相等） */
  let anonymousPreference: IPreferenceShape | null = null
  /** 轮换前的 signed RT_JTI cookie（重放用例要种回去） */
  let rotatedOutCookie = ''

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    accessSecret = app.get(ConfigService).get<string>('jwt.access.secret')!

    fixture = await registerRootUserFixture(app, api.pgDataSource, `jwt-guard-${seed8}`)
    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    validAt = tokens.accessToken
    // 探针 `/system/user/me/profile` 受 MFA guard（#9）约束，需要设备级 verified 缓存
    await api.seedMfaVerifiedCache(fixture.userId)

    // 偏好改成非默认值：匿名默认 zh_CN，本人是 en_US —— 降级与否一眼可辨
    const patch = await api.root('PATCH', api.apiPath('/system/user/preference/basic'), { locale: 'en_US' })
    expectOk(patch, 'preference basic patch')
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user_preference WHERE user_id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  /** 服务端密钥重签同一 payload（`expiresIn: '-10s'` 造过期令牌 / 换 secret 造坏签名） */
  async function resignValidAt(options: { secret?: string, expired?: boolean } = {}): Promise<string> {
    const jwtService = app.get(JwtService)
    const { iat: _iat, exp: _exp, ...payload } = jwtService.decode<Record<string, unknown>>(validAt)
    return jwtService.signAsync(payload, {
      secret: options.secret ?? accessSecret,
      expiresIn: options.expired === true ? '-10s' : '5m',
    })
  }

  /** 偏好 read（JwtOptional + SignFree/DeviceFree/MfaFree/LockFree）：可带任意 Authorization */
  async function getPreference(authorization?: string): Promise<SuperTestResponse> {
    return api.unsigned(
      'GET',
      api.apiPath(PREFERENCE_READ),
      undefined,
      authorization === undefined ? {} : { Authorization: authorization },
    )
  }

  function localeOf(res: SuperTestResponse): string {
    return bodyOf<IPreferenceShape>(res).data.basic.locale
  }

  describe('JwtOptional：带坏 AT 必须降级为匿名（不是 40101）', () => {
    it('正对照：有效 AT ⇒ 20000 且读到本人偏好 en_US', async () => {
      const res = await getPreference(`Bearer ${validAt}`)

      expectOk(res, 'preference read with valid AT')
      expect(localeOf(res)).toBe('en_US')
    })

    it('基准：完全不带 AT ⇒ 20000 + 匿名默认 zh_CN', async () => {
      const res = await getPreference()

      expectOk(res, 'preference read anonymous')
      anonymousPreference = bodyOf<IPreferenceShape>(res).data
      expect(anonymousPreference.basic.locale).toBe('zh_CN')
    })

    it('坏 AT（非 JWT 串）⇒ 20000 + 匿名默认（不是 40101，也不冒充登录态）', async () => {
      const res = await getPreference('Bearer not-a-jwt-at-all')

      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      expect(localeOf(res)).toBe('zh_CN')
      expect(bodyOf<IPreferenceShape>(res).data).toEqual(anonymousPreference)
    })

    it('坏 AT（形态合法但签名错）⇒ 同样降级为匿名', async () => {
      const forged = await resignValidAt({ secret: `${accessSecret}-forged` })
      const res = await getPreference(`Bearer ${forged}`)

      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      expect(localeOf(res)).toBe('zh_CN')
      expect(bodyOf<IPreferenceShape>(res).data).toEqual(anonymousPreference)
    })

    it('过期 AT ⇒ 降级为匿名；同一枚过期 AT 打受保护端点仍 40101（正对照）', async () => {
      const expired = await resignValidAt({ expired: true })

      const optionalRes = await getPreference(`Bearer ${expired}`)
      expect(bodyOf(optionalRes).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      expect(localeOf(optionalRes)).toBe('zh_CN')
      expect(bodyOf<IPreferenceShape>(optionalRes).data).toEqual(anonymousPreference)

      const guardedRes = await api.unsigned('GET', api.apiPath(PROTECTED_PATH), undefined, {
        Authorization: `Bearer ${expired}`,
      })
      expect(bodyOf(guardedRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
    })

    it('正对照：非 JWT 串 AT 打受保护端点 ⇒ 40101（「坏」不是被解析成了匿名身份）', async () => {
      const res = await api.unsigned('GET', api.apiPath(PROTECTED_PATH), undefined, {
        Authorization: 'Bearer not-a-jwt-at-all',
      })

      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
    })
  })

  describe('JwtFree：带坏 AT 完全忽略', () => {
    it('匿名基线：/system/lang/list/public 是 JwtFree（Sign/Device/Cap/Lock 全 Free）', async () => {
      const res = await api.unsigned('GET', api.apiPath(LANG_PUBLIC))

      expectOk(res, 'lang list public anonymous')
      expect(Array.isArray(bodyOf<unknown[]>(res).data)).toBe(true)
    })

    it('带坏 AT 与匿名返回同一份数据（JwtFree 判定发生在 AT 解析之前）', async () => {
      const anonymous = await api.unsigned('GET', api.apiPath(LANG_PUBLIC))
      const withBadAt = await api.unsigned('GET', api.apiPath(LANG_PUBLIC), undefined, {
        Authorization: 'Bearer not-a-jwt-at-all',
      })

      expect(bodyOf(withBadAt).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      expect(bodyOf<unknown[]>(withBadAt).data).toEqual(bodyOf<unknown[]>(anonymous).data)
    })

    it('带过期 AT 同样忽略（不落成 40101）', async () => {
      const expired = await resignValidAt({ expired: true })
      const res = await api.unsigned('GET', api.apiPath(LANG_PUBLIC), undefined, {
        Authorization: `Bearer ${expired}`,
      })

      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
    })
  })

  describe('RT 轮换后的凭据面（新 AT 可用 / 旧 AT 同会话仍可用 / 旧 RT 作废）', () => {
    it('refresh ⇒ 新 AT 可用，且新旧 AT 同会话（sid 不变）', async () => {
      rotatedOutCookie = api.getCookie(WalnutAdminConstCookieKeys.RT_JTI)!
      expect(rotatedOutCookie).toBeTruthy()

      const res = await api.anon('POST', api.apiPath('/auth/refresh'))
      expectOk(res, 'auth refresh')

      const newAt = bodyOf<{ accessToken: string }>(res).data.accessToken
      expect(typeof newAt).toBe('string')
      // 不用「新旧 AT 字符串不同」当判据：同一秒内签发的同 payload JWT 逐字节相同
      // （iat/exp 秒级），那是时钟粒度问题，不是轮换语义。轮换的证据看 RT 行 ——
      // Set-Cookie 回种的新 jti（随机串）必然与轮换前不同。
      const rotatedCookie = api.getCookie(WalnutAdminConstCookieKeys.RT_JTI)!
      expect(rotatedCookie).not.toBe(rotatedOutCookie)

      // 轮换只换令牌不换会话：sid 来自 RT payload，新旧 AT 相同
      expect(decodeJwtPayload(newAt).sid).toBe(decodeJwtPayload(validAt).sid)

      // 新 AT 可用（双因子签名依赖的会话键未变，sessionKey 沿用登录时那枚）
      api.setAuth({ ...api.getAuth()!, accessToken: newAt })
      const withNew = await api.root('GET', api.apiPath(PROTECTED_PATH))
      expectOk(withNew, 'protected with new AT')
    })

    it('旧 AT 在轮换后仍可用（实现口径：作废的是旧 RT，不是旧 AT）', async () => {
      api.setAuth({ ...api.getAuth()!, accessToken: validAt })

      const res = await api.root('GET', api.apiPath(PROTECTED_PATH))

      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
      // 若哪天真改成「轮换作废旧 AT」，上面这条会先红，届时同步改这里
      expect(decodeJwtPayload(validAt).sid).toBe(decodeJwtPayload(api.getAuth()!.accessToken).sid)
    })

    it('旧 RT（轮换前 jti）重放 ⇒ 40102 RefreshTokenExpired；现役 jti 仍可续期', async () => {
      const currentCookie = api.getCookie(WalnutAdminConstCookieKeys.RT_JTI)!
      expect(currentCookie).not.toBe(rotatedOutCookie)

      api.setCookie(WalnutAdminConstCookieKeys.RT_JTI, rotatedOutCookie)
      const replay = await api.anon('POST', api.apiPath('/auth/refresh'))
      expect(bodyOf(replay).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_REFRESH_TOKEN_EXPIRED)

      // jar 还原现役 jti：轮换不连带把客户端锁死
      api.setCookie(WalnutAdminConstCookieKeys.RT_JTI, currentCookie)
      const resume = await api.anon('POST', api.apiPath('/auth/refresh'))
      expectOk(resume, 'auth refresh after replay')
    })
  })
})

import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import type { WalnutAuthTokens } from './helpers/api-client'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { AppTechCacheCapService } from '@/modules/techniques/cache/service/cache.cap'
import { AppTechCacheDeviceService } from '@/modules/techniques/cache/service/cache.device'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { overrideAppSettings } from './helpers/app-settings'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { buildSignRaw, computeSingleFactorSign, generateNonce, solveCapChallenge, WALNUT_TEST_USER_AGENT } from './helpers/sign-handshake'

/**
 * F 段：guard/安全策略拒绝矩阵 —— 系统性覆盖每个 guard 的**拒绝路径**与安全策略的
 * 真实行为（既有 31 份 spec 大多只测「放行态」）。拒绝条件的真源是 guard 源码，
 * 每条断言 `body.code` 精确值 + 关键副作用；测出与预期不符的行为按「钉现状/登记发现」处理。
 *
 * 执行顺序有依赖（vitest 按 describe 声明序执行）：
 * 1. CAP case-A（新设备 DEVICE_NEW 未处理 + guard 验证缓存为空）必须先于一切 CAP-active
 *    成功请求 —— api-client 引导期的 cap redeem 不写 guard 缓存（`SECURITY_CAP_TOKEN` 只由
 *    CAP guard 验证成功后写入），因此 describe 第一个跑；
 * 2. Sign 安全语义（未登录单因子）在登录前跑；
 * 3. 其余（JWT/CAP case-B/Device/MFA/Lock/IP/functional）在 describe 级 beforeAll 登录后跑。
 *
 * 全局副作用自建自还原：settings 缓存（overrideAppSettings）、临时 IP 黑名单（显式 remove）、
 * 会话键（删除后重新登录换新会话）、锁定状态（unlock + 行清理）；device/initial 全文件只调
 * 2 次（主客户端 + 第二设备客户端），远低于 Throttle 4/60s 配额（专项连发在 throttle.api-spec.ts）。
 */

/** TEST-NET-3（RFC 5737 文档专用段）——伪造 X-Forwarded-For 不会路由到任何真实主机 */
const BANNED_IP_TEMP = '203.0.113.77'
const BANNED_IP_PERMANENT = '203.0.113.78'
const ALLOWED_PROBE_IP = '203.0.113.79'

describe('F 段：guard/安全策略拒绝矩阵（真实 guard 链，拒绝路径专项）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  /** 第二设备客户端（设备封禁闭环的解封通道，device guard 对本设备请求是拦死状态） */
  let apiB: WalnutApiClient | null = null

  const seed8 = randomUUID().slice(0, 8)
  let fixture1: WalnutRootUserFixture | null = null
  let fixture2: WalnutRootUserFixture | null = null
  let fixture3: WalnutRootUserFixture | null = null
  let tokens1: WalnutAuthTokens | null = null
  /** 主客户端设备行的 PG 主键（device ban/unban 的 :id 是行 uuid） */
  let deviceARowId = ''
  /** sign guard 的路径规范化正则（strip `/{prefix}/v{version}`，与 buildSignRaw 同口径） */
  let stripPrefixRegex: RegExp

  /** 客户端侧只消费签名断言需要的键（AT payload 完整形状见 IWalnutAdminAccessTokenPayload） */
  interface WalnutClientAtPayload {
    userId: string
    sid: string
    mfaSetup: boolean
    mfaVerified: boolean
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    const configService = app.get(ConfigService)
    stripPrefixRegex = new RegExp(
      `^/${configService.get<string>('app.api.prefix')}/v${configService.get<string>('app.api.version')}`,
    )
  })

  afterAll(async () => {
    if (api !== undefined) {
      const pg = api.pgDataSource
      for (const fixture of [fixture1, fixture2, fixture3]) {
        if (fixture === null) {
          continue
        }
        await pg.query('DELETE FROM sys_user_lock WHERE user_id = $1', [fixture.userId])
        await pg.query('UPDATE sys_user_device SET locked = false WHERE user_id = $1', [fixture.userId])
        await pg.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
        await pg.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
        await api.cleanupWalnutCacheKeys(fixture.userId)
      }
      const deviceIds = [api.deviceId, apiB?.deviceId].filter(id => id !== '') as string[]
      for (const deviceId of deviceIds) {
        await pg.query('DELETE FROM sys_device WHERE device_id = $1', [deviceId])
        await api.cleanupWalnutCacheKeys(deviceId)
      }
      await app.get(SharedIpService).removeFromTemporaryBlacklist(BANNED_IP_TEMP).catch(() => undefined)
    }
    await app?.close()
  })

  /** 解码主 AT payload 并剥离 iat/exp —— 带 exp 的 payload 再签会撞 jsonwebtoken 的 expiresIn 冲突 */
  function decodedAtPayload(): Record<string, unknown> {
    const jwtService = app.get(JwtService)
    const { iat: _iat, exp: _exp, ...payload } = jwtService.decode<Record<string, unknown>>(tokens1!.accessToken)
    return payload
  }

  /** 手工单因子签名头（未登录态 / JwtFree 路由；服务端 sign guard 按 req.user 缺失走单因子） */
  function singleFactorHeaders(opts: {
    method: 'GET' | 'POST' | 'PATCH'
    url: string
    body?: unknown
    timestamp?: number
    nonce?: string
  }): Record<string, string> {
    const timestamp = opts.timestamp ?? Date.now()
    const nonce = opts.nonce ?? generateNonce()
    const raw = buildSignRaw({
      method: opts.method,
      routePath: opts.url.replace(stripPrefixRegex, '') || '/',
      body: opts.body,
      timestamp,
      nonce,
      ua: WALNUT_TEST_USER_AGENT,
    })
    return {
      'X-Sign': computeSingleFactorSign(raw, api.handshakeAesKey),
      'X-Timestamp': String(timestamp),
      'X-Nonce': nonce,
    }
  }

  /**
   * CAP 状态复原：challenge → 本地 PoW 求解 → redeem 换全新 CAPJS_TOKEN（jar 自动捕获）。
   * 必须走这条路的原因：cap.js 的 token 是**一次性**的（validateToken 校验成功即从 store 删除），
   * 引导期 redeem 的那个 token 在第一次 CAP guard 校验时已被消费 —— guard 验证缓存一旦被清
   * （如本文件 D3），旧 cookie 永远无法再通过真验，只能重新 redeem。
   */
  async function redeemFreshCapToken(): Promise<void> {
    const challengeRes: SuperTestResponse = await api.unsigned('POST', api.apiPath('/security/cap/challenge'))
    const challengeBody = challengeRes.body as {
      challenge: { c: number, s: number, d: number }
      token: string
      expires: number
    }
    const solutions = solveCapChallenge(challengeBody.challenge, challengeBody.token)
    const redeemRes = await api.unsigned('POST', api.apiPath('/security/cap/redeem'), { token: challengeBody.token, solutions })
    expect((redeemRes.body as { success?: boolean }).success).toBe(true)
  }

  // ============================================================
  // CAP 强制态 · case A：risk 评估存在（新设备 DEVICE_NEW critical 因子未处理）
  // 且 guard 验证缓存（SECURITY_CAP_TOKEN:<deviceId>）为空 —— CAP 硬校验的拒绝面。
  // 必须最先执行：任何一次 CAP-active 成功请求都会 markChallengeHandled(DEVICE_NEW)
  // 并把验证缓存写满，case A 的前提即消失。
  // ============================================================
  describe('CAP 强制态 · case A：新设备 DEVICE_NEW 未处理 + 验证缓存为空', () => {
    it('缺 CAPJS_TOKEN cookie → 40116 CapInteractionRequired（shouldChallenge=true 硬拒）', async () => {
      const saved = api.getCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN)!
      api.dropCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN)
      try {
        const res: SuperTestResponse = await api.unsigned(
          'GET',
          api.apiPath('/'),
          undefined,
          singleFactorHeaders({ method: 'GET', url: api.apiPath('/') }),
        )
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN, saved)
      }
    })

    it('CAPJS_TOKEN 种伪造值（cookie-parser 验签失败静默丢弃 → guard 视同缺失）→ 40116', async () => {
      // 机制注记：cookie-parser 对验签失败的 signed cookie 直接不放进 req.signedCookies（undefined），
      // 所以「伪造值」到不了 guard 的真验分支，走的是「token 缺失」路径 —— 篡改在 cookie 层即被丢弃
      const saved = api.getCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN)!
      api.setCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN, `matrix-forged-${seed8}`)
      try {
        const res = await api.unsigned(
          'GET',
          api.apiPath('/'),
          undefined,
          singleFactorHeaders({ method: 'GET', url: api.apiPath('/') }),
        )
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN, saved)
      }
    })
  })

  // ============================================================
  // Sign guard 安全语义（未登录单因子；时间窗 5min / nonce 32hex 一次性，源码常量）
  // ============================================================
  describe('Sign guard 安全语义（未登录单因子）', () => {
    it('签名篡改：body 改一字节 → 重放原签名 → 40112 InvalidSignature（nonce 已记录、签名比对失败）', async () => {
      // 服务端按真实 body 现算 serverSign，与「按原 body 算出的客户端签名」必然失配；
      // validateAndRecordNonce 先于签名比对执行 → 该 nonce 被消费，重放亦不可达
      const res = await api.unsigned(
        'GET',
        api.apiPath('/'),
        { matrixProbe: seed8 },
        singleFactorHeaders({ method: 'GET', url: api.apiPath('/'), body: {} }),
      )
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)
    })

    it('X-Timestamp 漂移超窗（-6min > 5min 容差）→ 40112（时间戳校验先于 nonce 记录）', async () => {
      const drifted = Date.now() - 6 * 60 * 1000
      const res = await api.unsigned(
        'GET',
        api.apiPath('/'),
        undefined,
        singleFactorHeaders({ method: 'GET', url: api.apiPath('/'), timestamp: drifted }),
      )
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)
    })

    it('nonce 重放：同一 nonce 第二次请求 → 40112（一次性 nonce 存储真实生效）', async () => {
      const headers = singleFactorHeaders({ method: 'GET', url: api.apiPath('/') })
      const first = await api.unsigned('GET', api.apiPath('/'), undefined, headers)
      expectOk(first, 'nonce first use')

      const replay = await api.unsigned('GET', api.apiPath('/'), undefined, headers)
      expect(bodyOf(replay).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)
    })

    it('X-Nonce 格式非法（非 32hex；签名按该非法 nonce 现算仍拒）→ 40112（格式校验先于签名比对）', async () => {
      const res = await api.unsigned(
        'GET',
        api.apiPath('/'),
        undefined,
        singleFactorHeaders({ method: 'GET', url: api.apiPath('/'), nonce: 'matrix-bad-nonce' }),
      )
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)
    })

    it('缺 SIGN_TICKET cookie + ticket 缓存清空 → guard 分布式锁路径自动签发放行（20000 + Set-Cookie）', async () => {
      api.dropCookie(WalnutAdminConstCookieKeys.SIGN_TICKET)
      await api.cleanupWalnutCacheKeys(`${WalnutAdminConstAppCacheKeys.SECURITY_SIGN_TICKET}:${api.deviceId}`)

      const res = await api.anon('GET', api.apiPath('/'))
      expectOk(res, 'sign ticket auto issue')

      const setCookies = res.headers['set-cookie'] as unknown as string[]
      const ticketCookie = setCookies.find(raw => raw.startsWith(`${WalnutAdminConstCookieKeys.SIGN_TICKET}=`))
      expect(ticketCookie).toBeTruthy()
      // 注意：不还原旧 ticket —— guard 已签发新 ticket（jar 自动捕获新值），把旧值种回去
      // 会造成 cookie 与缓存失配，后续所有签名请求 40112（本次专项实测踩坑）。
      expect(api.getCookie(WalnutAdminConstCookieKeys.SIGN_TICKET)).toBeTruthy()
    })
  })

  // ============================================================
  // 登录基线 + JWT 生命周期 + CAP case-B + Device + MFA + Lock + IP + functional
  // ============================================================
  describe('登录基线 / JWT 生命周期（会话与算法篡改拒绝面）', () => {
    beforeAll(async () => {
      fixture1 = await registerRootUserFixture(app, api.pgDataSource, `gmx1-${seed8}`)
      tokens1 = await performHttpOpaqueLogin(api, app, fixture1)
      api.setAuth(tokens1)
      await api.seedMfaVerifiedCache(fixture1.userId)

      // 第二设备客户端：同 root fixture 登录（设备封禁闭环的解封通道）
      apiB = await WalnutApiClient.create(app)
      const tokensB = await performHttpOpaqueLogin(apiB, app, fixture1)
      apiB.setAuth(tokensB)
      await apiB.seedMfaVerifiedCache(fixture1.userId)

      const rows: Array<{ id: string }> = await api.pgDataSource.query(
        'SELECT id FROM sys_device WHERE device_id = $1',
        [api.deviceId],
      )
      deviceARowId = rows[0].id
    })

    it('放行基线：root 全链请求 20000（登录 + MFA verified 缓存 + CAP 全通过）', async () => {
      const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expectOk(res, 'baseline')
    })

    it('AT 过期（-10s 签发）→ 40101 AccessTokenExpired（passport-jwt ignoreExpiration=false）', async () => {
      const jwtService = app.get(JwtService)
      const accessSecret = app.get(ConfigService).get<string>('jwt.access.secret')!
      const expiredAt = await jwtService.signAsync(decodedAtPayload(), { secret: accessSecret, expiresIn: '-10s' })

      api.setAuth({ ...tokens1!, accessToken: expiredAt })
      try {
        const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
      }
      finally {
        api.setAuth(tokens1)
      }
    })

    it('签名密钥篡改（同 payload 换 secret 的 HS256）→ 40101', async () => {
      const jwtService = app.get(JwtService)
      const forgedAt = await jwtService.signAsync(decodedAtPayload(), { secret: `matrix-wrong-${seed8}`, expiresIn: '5m' })

      api.setAuth({ ...tokens1!, accessToken: forgedAt })
      try {
        const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
      }
      finally {
        api.setAuth(tokens1)
      }
    })

    it('alg=none 伪造 token（空签名段）→ 40101（passport-jwt 拒绝 none 算法）', async () => {
      const jwtService = app.get(JwtService)
      const payload = jwtService.decode<Record<string, unknown>>(tokens1!.accessToken)
      const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
      const noneAt = `${head}.${body}.`

      api.setAuth({ ...tokens1!, accessToken: noneAt })
      try {
        const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
      }
      finally {
        api.setAuth(tokens1)
      }
    })

    it('AT payload userId 不存在（正确签名）+ 双因子签名 → 40112（sign guard 查无会话降级单因子，与客户端双因子失配）', async () => {
      const jwtService = app.get(JwtService)
      const accessSecret = app.get(ConfigService).get<string>('jwt.access.secret')!
      const ghost = {
        ...decodedAtPayload(),
        userId: randomUUID(),
        sid: randomUUID().replaceAll('-', ''),
        mfaVerified: true, // payload 可伪造 → MFA guard 的 mfaVerified 短路被穿透（登记发现）
      }
      const ghostAt = await jwtService.signAsync(ghost, { secret: accessSecret, expiresIn: '5m' })

      api.setAuth({ ...tokens1!, accessToken: ghostAt })
      try {
        const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)
      }
      finally {
        api.setAuth(tokens1)
      }
    })

    it('【安全矩阵发现】同 ghost AT + 单因子签名 → 20000（deriveApiSignKey 失败降级单因子：会话吊销/用户存在性对「自选签名模式的客户端」不设防）', async () => {
      const jwtService = app.get(JwtService)
      const accessSecret = app.get(ConfigService).get<string>('jwt.access.secret')!
      const ghost = {
        ...decodedAtPayload(),
        userId: randomUUID(),
        sid: randomUUID().replaceAll('-', ''),
        mfaVerified: true,
      }
      const ghostAt = await jwtService.signAsync(ghost, { secret: accessSecret, expiresIn: '5m' })

      const res = await api.unsigned(
        'GET',
        api.apiPath('/system/user/lock/read'),
        undefined,
        {
          Authorization: `Bearer ${ghostAt}`,
          ...singleFactorHeaders({ method: 'GET', url: api.apiPath('/system/user/lock/read') }),
        },
      )
      // 服务端：req.user 存在 → 双因子派生 → 会话查无 → **降级单因子** → 与客户端单因子签名匹配 → 放行。
      // 合法客户端「忘改签名模式」被 40112 拦（见上一用例），但攻击者客户端显式发单因子即可绕过
      // 会话绑定 —— 双因子的会话吊销能力仅对诚客户端生效。
      expectOk(res, 'ghost AT with single-factor sign')
    })

    it('会话吊销（删 AUTH:SESSIONS 键）后旧 AT 双因子签名 → 40112（session 校验真实查缓存；随后重登恢复）', async () => {
      const jwtService = app.get(JwtService)
      const { sid } = jwtService.decode<WalnutClientAtPayload>(tokens1!.accessToken)
      await api.cleanupWalnutCacheKeys(sid)

      const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)

      // 旧会话键已删不可复原 —— signout 撤销本会话 RT（否则重登撞 40109 Duplicate Auth），
      // 换新会话供后续 describe 使用。注意 D 段口径：登录链是 JwtFree+Sign 生效路由，
      // 登录态 jar 的 anon() 双因子签名必 40112，必须先 setAuth(null) 回单因子再走 login 链。
      await api.root('POST', api.apiPath('/auth/signout'))
      api.setAuth(null)
      tokens1 = await performHttpOpaqueLogin(api, app, fixture1!)
      api.setAuth(tokens1)
      await api.seedMfaVerifiedCache(fixture1!.userId)
    })
  })

  describe('CAP 强制态 · case B：DEVICE_NEW 已处理（策略降级面 40117）与设备级信任窗口', () => {
    it('缺 CAPJS_TOKEN（shouldChallenge=false 的策略降级仍拒）→ 40117 CapRefreshRequired', async () => {
      const saved = api.getCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN)!
      api.dropCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN)
      try {
        const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_REFRESH_REQUIRED)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN, saved)
      }
    })

    it('【安全矩阵发现】验证缓存命中期间移植另一台设备的签名 token cookie → 20000（guard 只按 deviceId 查 boolean 缓存，token 值/设备绑定不比对）', async () => {
      // apiB 的 CAPJS_TOKEN 是同一服务端签名的**有效签名 cookie**（跨设备移植后 cookie-parser 验签通过），
      // 但 guard 的缓存快路径只按本设备 deviceId 查 boolean，从不比对 token 值与设备的绑定 —— 窃取的
      // token cookie 在缓存窗口内完全可移植（且缓存 TTL 见 ENDPOINTS 发现节：实际远超 token 有效期）
      const stolen = apiB!.getCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN)!
      const saved = api.getCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN)!
      api.setCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN, stolen)
      try {
        const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expectOk(res, 'stolen cross-device cap token with warm cache')
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN, saved)
      }
    })

    it('缓存清空 + 已消费的原始 token → 40117（真验路径：cap.js token 单次有效，validateToken 成功即删）；重新 redeem 后恢复 20000', async () => {
      await app.get(AppTechCacheCapService).delCapTokenCache(api.deviceId)

      // 原始 cookie 签名有效（可达真验分支），但该 token 在第一次 CAP guard 校验时已被 cap.js 删除
      const rejected = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expect(bodyOf(rejected).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_REFRESH_REQUIRED)

      // 重新 challenge → solve → redeem 换全新 token（新 cookie 由 redeem 响应写入 jar）
      await redeemFreshCapToken()

      const restored = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expectOk(restored, 'cap state restored via fresh redeem')
    })
  })

  describe('Device guard：cookie 缺失 / 篡改 / 封禁-解封闭环', () => {
    it('缺 DEVICE_ID cookie → 40605 DeviceNotAcceptable', async () => {
      const saved = api.getCookie(WalnutAdminConstCookieKeys.DEVICE_ID)!
      api.dropCookie(WalnutAdminConstCookieKeys.DEVICE_ID)
      try {
        const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.DEVICE_ID, saved)
      }
    })

    it('篡改 DEVICE_ID（signed cookie 验签失败 → 视同缺失/无效）→ 40605', async () => {
      const saved = api.getCookie(WalnutAdminConstCookieKeys.DEVICE_ID)!
      const tampered = (saved.startsWith('s:') ? saved.slice(2) : saved).split('').reverse().join('')
      api.setCookie(WalnutAdminConstCookieKeys.DEVICE_ID, tampered)
      try {
        const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.DEVICE_ID, saved)
      }
    })

    it('封禁闭环：第二设备 HTTP ban → 本设备 40607 → HTTP unban → 恢复放行（ban/unban 只写 SYS_DEVICE 缓存不落库）', async () => {
      const banRes = await apiB!.root('PATCH', apiB!.apiPath(`/system/device/${deviceARowId}/ban`))
      expectOk(banRes, 'ban device A')
      const cachedAfterBan = await app.get(AppTechCacheDeviceService).getSysDeviceCache(api.deviceId)
      expect(cachedAfterBan?.banned).toBe(true)

      const blocked = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expect(bodyOf(blocked).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_BANNED)

      const unbanRes = await apiB!.root('PATCH', apiB!.apiPath(`/system/device/${deviceARowId}/unban`))
      expectOk(unbanRes, 'unban device A')

      const restored = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expectOk(restored, 'device A restored after unban')
    })
  })

  describe('MFA guard 强制态（已登录）', () => {
    afterEach(async () => {
      // 还原主 fixture 登录态（其 verified 缓存仍在），后续 describe 依赖 tokens1
      if (tokens1 !== null) {
        api.setAuth(tokens1)
      }
    })

    it('mfa_setup=true 用户 + 未种设备 verified 缓存 → 40115 MfaVerifyFailed（登录时 isTrusted=false → payload.mfaVerified=false）', async () => {
      fixture2 = await registerRootUserFixture(app, api.pgDataSource, `gmx2-${seed8}`)
      // 登录链是 JwtFree+Sign 生效路由：登录态 jar 的双因子签名必 40112，先回单因子
      api.setAuth(null)
      const tokens2 = await performHttpOpaqueLogin(api, app, fixture2)
      api.setAuth(tokens2)

      const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED)
    })

    it('种 verified 缓存（真实缓存通道）后 → 20000', async () => {
      await api.seedMfaVerifiedCache(fixture2!.userId)
      const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expectOk(res, 'mfa verified via device cache')
    })

    it('mfa_setup=false 用户 → 40114 MfaRequired（mfa.guard P5：未启用 MFA 的用户无法使用系统）', async () => {
      fixture3 = await registerRootUserFixture(app, api.pgDataSource, `gmx3-${seed8}`)
      await api.pgDataSource.query('UPDATE sys_user SET mfa_setup = false WHERE id = $1', [fixture3.userId])
      api.setAuth(null)
      const tokens3 = await performHttpOpaqueLogin(api, app, fixture3)
      api.setAuth(tokens3)

      const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_REQUIRED)
    })
  })

  describe('Lock guard：用户-设备锁定 40118 闭环（lock/unlock 端点 LockFree 可达）', () => {
    async function cleanLockRows() {
      if (fixture1 === null) {
        return
      }
      await api.pgDataSource.query('DELETE FROM sys_user_lock WHERE user_id = $1', [fixture1.userId])
      await api.pgDataSource.query('UPDATE sys_user_device SET locked = false WHERE user_id = $1', [fixture1.userId])
      const cacheService = app.get(AppTechCacheService)
      const lockKeys = WalnutAdminConstAppCacheKeys.SECURITY_LOCK
      await cacheService.del(`${lockKeys}:${fixture1.userId}:global`)
      await cacheService.del(`${lockKeys}:${fixture1.userId}:${api.deviceId}`)
    }

    afterEach(async () => {
      await cleanLockRows()
    })

    it('lock → 全链请求 40118 UserLocked（SECURITY_LOCK 缓存命中）→ unlock → 恢复 20000', async () => {
      const lockRes = await api.root('PATCH', api.apiPath('/system/user/lock'), { lockRoute: { name: `matrix-${seed8}` } })
      expectOk(lockRes, 'lock me')

      // 探针必须是「非 LockFree」的全链端点（user_lock 自家 read/lock/unlock 全是 LockFree，锁不住）
      const blocked = await api.root('GET', api.apiPath('/system/user/me/profile'))
      expect(bodyOf(blocked).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)

      const unlockRes = await api.root('PATCH', api.apiPath('/system/user/lock/unlock'), {})
      expectOk(unlockRes, 'unlock me')

      const restored = await api.root('GET', api.apiPath('/system/user/me/profile'))
      expectOk(restored, 'lock guard restored')
    })
  })

  describe('IP guard：X-Forwarded-For 伪造（realIp 取第一个 XFF，@supercharge/request-ip 不校验跳数）', () => {
    it('临时黑名单 IP → 40603 IPBlocked；移除后同 IP 放行（闭环）', async () => {
      const ipService = app.get(SharedIpService)
      await ipService.addToTemporaryBlacklist(BANNED_IP_TEMP, 'GUARD_MATRIX_SPEC')
      try {
        const blocked = await api.unsigned(
          'GET',
          api.apiPath('/'),
          undefined,
          {
            'x-forwarded-for': BANNED_IP_TEMP,
            ...singleFactorHeaders({ method: 'GET', url: api.apiPath('/') }),
          },
        )
        expect(bodyOf(blocked).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED)
      }
      finally {
        await ipService.removeFromTemporaryBlacklist(BANNED_IP_TEMP)
      }

      const allowed = await api.unsigned(
        'GET',
        api.apiPath('/'),
        undefined,
        {
          'x-forwarded-for': BANNED_IP_TEMP,
          ...singleFactorHeaders({ method: 'GET', url: api.apiPath('/') }),
        },
      )
      expectOk(allowed, 'temp blacklist removed')
    })

    it('永久黑名单（APP:SETTING 缓存注入 APP_GLOBAL_IP_BLACKLIST）→ 40603', async () => {
      const restore = await overrideAppSettings(app, {
        [WalnutAdminConstAppSettingKeys.APP_GLOBAL_IP_BLACKLIST]: JSON.stringify([BANNED_IP_PERMANENT]),
      })
      try {
        const blocked = await api.unsigned(
          'GET',
          api.apiPath('/'),
          undefined,
          {
            'x-forwarded-for': BANNED_IP_PERMANENT,
            ...singleFactorHeaders({ method: 'GET', url: api.apiPath('/') }),
          },
        )
        expect(bodyOf(blocked).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED)
      }
      finally {
        await restore()
      }
    })

    it('【安全矩阵发现】非黑名单伪造 IP 直通 → 20000（IP 维度风控/限流的 tracker 可被请求头改写）', async () => {
      const res = await api.unsigned(
        'GET',
        api.apiPath('/'),
        undefined,
        {
          'x-forwarded-for': ALLOWED_PROBE_IP,
          ...singleFactorHeaders({ method: 'GET', url: api.apiPath('/') }),
        },
      )
      expectOk(res, 'spoofed ip passthrough')
    })

    it('【安全矩阵发现】security.guard 黑名单路径分支不可达：/w/v1/admin → 40400 而非 40610（前缀化路由永不命中 startsWith(/admin)，未路由路径根本不进 guard）', async () => {
      const res = await api.unsigned(
        'GET',
        api.apiPath('/admin'),
        undefined,
        singleFactorHeaders({ method: 'GET', url: api.apiPath('/admin') }),
      )
      // 黑名单路径检查用完整 req.path（含 /w/v1 前缀）做 startsWith('/admin') —— 所有真实路由都带
      // API 前缀，永不命中；而扫描器打的真实裸路径（/admin）不匹配任何路由 → 404，guard 链不执行。
      // addToPermanentBlackList 的自动拉黑副作用因此不可达。
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND)
    })
  })

  describe('functional guard 代表性对照（opaque login/start，与 D 段 google 不重复）', () => {
    it('APP_AUTH_OPAQUE.authEnable=0 → 50301 EndPointUnavailable（guard 先于 passport 与 DTO 校验）', async () => {
      const restore = await overrideAppSettings(app, {
        [WalnutAdminConstAppSettingKeys.APP_AUTH_OPAQUE]: JSON.stringify({ authEnable: '0' }),
      })
      api.setAuth(null)
      try {
        const res = await api.anon('POST', api.apiPath('/auth/opaque/user/login/start'), {
          userName: `matrix-probe-${seed8}`,
          start: {},
        })
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_ENDPOINT_DOWN)
      }
      finally {
        await restore()
        api.setAuth(tokens1)
      }
    })
  })
})

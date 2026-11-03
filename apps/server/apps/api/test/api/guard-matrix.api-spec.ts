import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import type { WalnutAuthTokens } from './helpers/api-client'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { AppTechCacheCapService, AppTechCacheDeviceService, AppTechCacheMfaService, AppTechCacheService, AppTechRedisService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { SharedIpService } from '@walnut-server/ip'
import { SecurityRiskConfigService, WalnutAdminConstRiskLevel } from '@walnut-server/security'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import supertest from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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
/** 黑名单路径用例的承载 IP（自动拉黑副作用落在它身上，用后显式移除） */
const BANNED_IP_SCAN_PROBE = '203.0.113.80'

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
  /** 第二设备（同 fixture1）登录令牌 —— G2 跨设备重放与 G5 跨设备锁定共用 */
  let tokensB1: WalnutAuthTokens | null = null
  /** fixture2 的登录令牌（G12：mfaVerified 自报短路；登录时 isTrusted=false） */
  let tokens2: WalnutAuthTokens | null = null
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

    // P3-38（测试确定性）：TEST-NET-3 是 RFC 5737 文档保留段，risk guard 的 location
    // 评估会外连 `api.ip.sb/geoip`；该服务对保留 IP 段返回 HTTP 400 → 50302，与本文件
    // 断言的「IP guard 放行伪造 IP」无关，曾使「非黑名单伪造 IP 直通」用例确定性失败。
    // 修法：把 location 结果预写进它的**真实缓存通道**——SecurityRiskLocationService 读
    // AppTechRedisService 的 `risk:location:<normalizedIp>`（不是 CACHE_MANAGER，内存
    // cache 替换对这条链路无效），命中缓存即不再外连。覆盖会走到 location 评估的两个
    // 探针 IP：.77（临时黑名单移除后的放行腿 / G14 已拉黑 IP 的 40603 探针）与 .79（直通用例）。
    await seedLocationRiskCache(BANNED_IP_TEMP)
    await seedLocationRiskCache(ALLOWED_PROBE_IP)
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
      await clearLocationRiskCache(BANNED_IP_TEMP)
      await clearLocationRiskCache(ALLOWED_PROBE_IP)
    }
    await app?.close()
  })

  /**
   * 预写 location 风控缓存（LOW）：键与形状对齐 SecurityRiskLocationService.getInfoKey /
   * IWalnutAdminLocationRiskInfo，走 AppTechRedisService 直连（与生产同一缓存通道）。
   */
  async function seedLocationRiskCache(ip: string): Promise<void> {
    const riskConfig = app.get(SecurityRiskConfigService)
    const normalizedIp = await app.get(SharedIpService).normalizeIp(ip)
    const key = `${riskConfig.redis.location}:${normalizedIp}`
    const payload: IWalnutAdminLocationRiskInfo = {
      ip,
      location: {
        ip,
        country: 'LOCAL',
        region: 'LOCAL',
        city: 'LOCAL',
      },
      score: 0,
      factors: [],
      level: WalnutAdminConstRiskLevel.LOW,
      evaluatedAt: Date.now(),
    }
    await app.get(AppTechRedisService).getClient().setEx(key, riskConfig.ttl.location, JSON.stringify(payload))
  }

  async function clearLocationRiskCache(ip: string): Promise<void> {
    const normalizedIp = await app.get(SharedIpService).normalizeIp(ip)
    const key = `${app.get(SecurityRiskConfigService).redis.location}:${normalizedIp}`
    await app.get(AppTechRedisService).getClient().del(key)
  }

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

  /**
   * 扫 Redis 里某 (user, device) 的会话键（`WALNUT_CACHE_AUTH:SESSIONS:<user>:<device>:*`）。
   * 「封禁清会话」要断言的是**整组键消失** —— 按已知 sid 逐个断言只能覆盖那一个会话。
   */
  async function scanSessionKeys(userId: string, deviceId: string): Promise<string[]> {
    const redis = app.get(AppTechRedisService).getClient()
    const pattern = `WALNUT_CACHE_${WalnutAdminConstAppCacheKeys.AUTH_SESSIONS}:${userId}:${deviceId}:*`
    const keys: string[] = []
    for await (const batch of redis.scanIterator({ MATCH: pattern, COUNT: 200 })) {
      // node-redis v5 的 scanIterator 按批产出 string[]（与 cache.service.delByPattern 同口径摊平）
      const list: string[] = Array.isArray(batch) ? batch : [batch]
      keys.push(...list.filter((key): key is string => typeof key === 'string'))
    }
    return keys
  }

  /** 该 (user, device) 的**现役** RT 行数（`revoked = false`；撤销按设备维度整片生效） */
  async function countActiveRt(userId: string, deviceId: string): Promise<number> {
    const rows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2 AND revoked = false',
      [userId, deviceId],
    )
    return rows[0].c
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

    it('nonce 并发：同一 nonce 双请求并发 → 恰一通过（SET NX EX 原子判重，P2-11）', async () => {
      const headers = singleFactorHeaders({ method: 'GET', url: api.apiPath('/') })

      const [a, b] = await Promise.all([
        api.unsigned('GET', api.apiPath('/'), undefined, headers),
        api.unsigned('GET', api.apiPath('/'), undefined, headers),
      ])

      const codes = [bodyOf(a).code, bodyOf(b).code]
      expect(codes.filter(code => code === WalnutAdminConstAppResponseCode.SUCCESS)).toHaveLength(1)
      expect(codes.filter(code => code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)).toHaveLength(1)
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
  // G1：Security guard 拒绝面（UA 存在性 / bot / suspicious / OS·浏览器白名单）
  // 用裸 supertest 精确控制 User-Agent（api-client 恒带真实浏览器 UA）；目标端点
  // security/rsa/public-key 无 Free 标记，Security guard 是第一个会拒绝的关卡。
  // ============================================================
  describe('Security guard：UA 缺失 / bot / suspicious / OS·浏览器白名单（G1）', () => {
    const probePath = '/security/rsa/public-key'

    it('UA 缺失（裸请求无 user-agent 头）→ 40604 UserAgentNotAcceptable', async () => {
      const res = await supertest(app.getHttpServer()).get(api.apiPath(probePath))
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_USER_AGENT_UNSUPPORTED)
    })

    it('bot UA（isbot 命中）→ 40608 BotDetected', async () => {
      const res = await supertest(app.getHttpServer())
        .get(api.apiPath(probePath))
        .set('user-agent', 'Googlebot/2.1 (+http://www.google.com/bot.html)')
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BOT_DETECTED)
    })

    it('suspicious UA（无 os/browser 可解析且非 bot）→ 40609 SuspiciousRequest', async () => {
      // isbot 对未知的自定义短串判定不稳定（'x' / 'Foo/1.2.3' 会被当 bot → 40608），
      // 这里用 isbot=false 且 UAParser 解析不出 os/browser 的串，命中 suspicious 分支
      const res = await supertest(app.getHttpServer())
        .get(api.apiPath(probePath))
        .set('user-agent', 'MyApp/1.0 (compatible; test-client)')
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_SUSPICIOUS_REQUEST)
    })

    it('OS 白名单收紧（只留 Plan9）→ 真实浏览器 UA 40601 UserAgentOSNotAcceptable', async () => {
      const restore = await overrideAppSettings(app, {
        [WalnutAdminConstAppSettingKeys.APP_GLOBAL_OS_WHITELIST]: JSON.stringify(['Plan9']),
      })
      try {
        const res = await supertest(app.getHttpServer())
          .get(api.apiPath(probePath))
          .set('user-agent', WALNUT_TEST_USER_AGENT)
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_OS_UNSUPPORTED)
      }
      finally {
        await restore()
      }
    })

    it('浏览器白名单收紧（只留 Lynx）→ 真实浏览器 UA 40602 UserAgentBrowserNotAcceptable', async () => {
      const restore = await overrideAppSettings(app, {
        [WalnutAdminConstAppSettingKeys.APP_GLOBAL_BROWSER_WHITELIST]: JSON.stringify(['Lynx']),
      })
      try {
        const res = await supertest(app.getHttpServer())
          .get(api.apiPath(probePath))
          .set('user-agent', WALNUT_TEST_USER_AGENT)
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BROWSER_UNSUPPORTED)
      }
      finally {
        await restore()
      }
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
      tokensB1 = await performHttpOpaqueLogin(apiB, app, fixture1)
      apiB.setAuth(tokensB1)
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

    it('AT payload userId 不存在（正确签名）+ 双因子签名 → 40101（P0-4：JWT validate 查会话键，ghost user 无会话被 JWT 层先拦）', async () => {
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
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
      }
      finally {
        api.setAuth(tokens1)
      }
    })

    it('ghost AT + 单因子签名 → 40101 拒绝（P0-2/P0-4 双保险：JWT 层会话键查无先拒，sign guard 不再降级单因子）', async () => {
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
      // 修复前：req.user 存在 → 双因子派生失败 → 降级单因子 → 攻击者显式单因子签名 20000 通过。
      // 修复后：JWT validate 先查 AUTH:SESSIONS（ghost user 查无）→ 40101；即便 sessions 键
      // 存在但 sign 层派生失败，sign guard 也直接 40112 拒绝（不再回落单因子）。
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
    })

    it('G2 跨设备 AT 重放：B 的 DEVICE_ID cookie + A 的 AT → 40101（会话键 user+deviceB 查无；JWT 先于 Sign）', async () => {
      // A/B 是同一 user 的两台设备、各自会话。把 A 的 AT 放进 B 的 cookie jar：
      // JWT validate 用「B 的 deviceId + A 的 sid」查 AUTH:SESSIONS → 查无 → 40101。
      // 校验序：JWT（全局 #6）先于 Sign（#10）—— 即便 B 的 aesKey 与 A 的 AT 组合出
      // 合法双因子签名也到不了 Sign；若会话键存在而签名密钥失配，第二道闸才是 40112。
      apiB!.setAuth(tokens1)
      try {
        const res = await apiB!.root('GET', apiB!.apiPath('/system/user/lock/read'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
      }
      finally {
        apiB!.setAuth(tokensB1)
      }
    })

    it('会话吊销（删 AUTH:SESSIONS 键）后旧 AT 双因子签名 → JWT 层 40101（P0-4；随后 SQL 撤 RT 重登恢复）', async () => {
      const jwtService = app.get(JwtService)
      const { sid } = jwtService.decode<WalnutClientAtPayload>(tokens1!.accessToken)
      await api.cleanupWalnutCacheKeys(sid)

      const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
      // P0-4 修复后：JWT validate 查会话键先于 sign guard → 40101（修复前由 sign guard 40112）
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

      // 旧会话键已删、旧 AT 已不可用于任何登录态端点（含 signout）—— 直接 SQL 撤销本用户
      // 未撤销的 RT（否则重登撞 40109 Duplicate Auth），再走登录链换新会话。
      await api.pgDataSource.query(
        'UPDATE auth_refresh_token SET revoked = true WHERE user_id = $1 AND revoked = false',
        [fixture1!.userId],
      )
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

    it('跨设备移植另一台设备的签名 token cookie → 40117 拒绝（P0-3：缓存键掺 token 指纹，本设备缓存不命中；真验时该 token 已被 cap.js 消费）', async () => {
      // P0-3 修复后：guard 的缓存键 = SECURITY_CAP_TOKEN:<deviceId>:sha256(token)[:16]，
      // 拿 apiB 的 token 到本设备（A）查询不命中 → 走 cap.js 真验 —— B 的 token 在 B 登录
      // 链上已被消费（validateToken 成功即从 store 删除）→ 验签失败 → shouldChallenge=false
      // 的策略降级面 40117。（修复前只按 deviceId 查 boolean，移植即 20000 放行。）
      const stolen = apiB!.getCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN)!
      const saved = api.getCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN)!
      api.setCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN, stolen)
      try {
        const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_REFRESH_REQUIRED)
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

    it('封禁闭环（封禁 = 踢下线）：第二设备 HTTP ban → 本设备 40607 + 该设备 RT 全撤 + 会话键清空 → unban 后旧 AT 仍 40101（处理器前）→ 重新登录才恢复放行', async () => {
      const cacheDevice = app.get(AppTechCacheDeviceService)
      const deviceId = api.deviceId
      const oldTokens = api.getAuth()!
      /** 封禁前那枚 signed RT_JTI cookie（下面验「RT 面也死了」用；签名绑定 jti，事后造不出来） */
      const preBanRtCookie = api.getCookie(WalnutAdminConstCookieKeys.RT_JTI)!

      // 本用例有两次「破坏性」动作：封禁设备 + 断掉本设备会话。两者都必须能**无条件还原** ——
      // 否则断言一失败，后面 12 条就被 40607/40101 连带打红，「1 条红」变成「整个文件红」，
      // 变异测试也看不出到底是谁在咬。
      let deviceUnbanned = false
      let sessionRebuilt = false

      /** 解封：走第二设备（与本设备会话死活无关，device guard 只拦被封的那台） */
      const unbanDevice = async () => {
        if (deviceUnbanned) {
          return
        }
        const res = await apiB!.root('PATCH', apiB!.apiPath(`/system/device/${deviceARowId}/unban`))
        expectOk(res, 'unban device A')
        deviceUnbanned = true
      }

      /**
       * 重建登录态：ban 起本设备会话就死了，后续所有 api.root 都依赖新 tokens1。
       * 登录链只有 JwtFree —— 带着登录态时客户端会算双因子签名反而 40112，故先回单因子；
       * 中途失败也把 auth 还原回「当前已知的 tokens1」，别让 auth=null 成为后续用例的死因。
       */
      const rebuildSession = async () => {
        if (sessionRebuilt) {
          return
        }
        api.setAuth(null)
        try {
          tokens1 = await performHttpOpaqueLogin(api, app, fixture1!)
        }
        finally {
          api.setAuth(tokens1)
          sessionRebuilt = true
        }
        await api.seedMfaVerifiedCache(fixture1!.userId)
      }

      try {
        // —— 前置自证：会话键 / MFA verified 键 / 现役 RT 都在场，否则下面的「清空」不说明任何事 ——
        expect((await scanSessionKeys(fixture1!.userId, deviceId)).length).toBeGreaterThan(0)
        expect(await api.hasWalnutCacheKey(`${WalnutAdminConstAppCacheKeys.AUTH_MFA_VERIFIED}:${fixture1!.userId}:${deviceId}`)).toBe(true)
        expect(await countActiveRt(fixture1!.userId, deviceId)).toBe(1)

        const banRes = await apiB!.root('PATCH', apiB!.apiPath(`/system/device/${deviceARowId}/ban`))
        expectOk(banRes, 'ban device A')

        // ban 落库 + 缓存双写（P2-2 起就落库；「只写 SYS_DEVICE 缓存」是更早的旧行为）
        const bannedRows: Array<{ banned: boolean }> = await api.pgDataSource.query(
          'SELECT banned FROM sys_device WHERE device_id = $1',
          [deviceId],
        )
        expect(bannedRows[0].banned).toBe(true)
        expect((await cacheDevice.getSysDeviceCache(deviceId))?.banned).toBe(true)

        // 封禁态下最先拒绝的是设备 guard（全局 #3）：连旧 AT 都到不了 JWT
        const blocked = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(blocked).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_BANNED)

        // ① RT 全撤：同事务按**设备**撤销（reason = deviceBanned），不是只撤当前用户那一行
        expect(await countActiveRt(fixture1!.userId, deviceId)).toBe(0)
        const bannedRtRows: Array<{ c: number }> = await api.pgDataSource.query(
          `SELECT count(*)::int AS c FROM auth_refresh_token WHERE device_id = $1 AND revoke_reason = 'deviceBanned'`,
          [deviceId],
        )
        expect(bannedRtRows[0].c).toBeGreaterThan(0)

        // ② 会话键清空（AUTH:SESSIONS:<user>:<device>:*）+ MFA verified 键清空。
        //    这两步在 after-commit 钩子里，而事务拦截器在**返回响应前** await 它们，故无需轮询。
        expect(await scanSessionKeys(fixture1!.userId, deviceId)).toEqual([])
        expect(await api.hasWalnutCacheKey(`${WalnutAdminConstAppCacheKeys.AUTH_MFA_VERIFIED}:${fixture1!.userId}:${deviceId}`)).toBe(false)

        // 封禁态下 /auth/refresh 也被设备 guard 拦（拍板-4 摘掉了它的 DeviceFree）→ 续不出新 AT
        const refreshWhileBanned = await api.anon('POST', api.apiPath('/auth/refresh'))
        expect(bodyOf(refreshWhileBanned).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_BANNED)

        await unbanDevice()
        expect((await cacheDevice.getSysDeviceCache(deviceId))?.banned).toBe(false)

        // ③ 解封**不恢复会话**（封禁 = 踢下线）：旧 AT 立刻 40101。
        //    「处理器前拒绝」的两条判别证据：
        //    a) 同一枚旧 AT 打「处理器内会回 40401」的不存在行 uuid → 仍是 40101
        //       ⇒ 请求根本没进处理器（死在 JWT 守卫 #6）；
        //    b) 回的是 40101 而不是 40115：踢下线已清 MFA verified 缓存，若 JWT 放行则由
        //       MFA guard（#9）先拒 —— 实测 40101 说明拒绝发生在 MFA 之前（守卫链内）。
        const ghostRowId = randomUUID()
        const staleAt = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(staleAt).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
        const staleAtOnHandler = await api.root('GET', api.apiPath(`/system/device/${ghostRowId}`))
        expect(bodyOf(staleAtOnHandler).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

        // RT 面同样已死：封禁前那枚 RT 再换 AT → 40102（撤销行在 JwtRefreshGuard 层即死）
        api.setCookie(WalnutAdminConstCookieKeys.RT_JTI, preBanRtCookie)
        const staleRefresh = await api.anon('POST', api.apiPath('/auth/refresh'))
        expect(bodyOf(staleRefresh).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_REFRESH_TOKEN_EXPIRED)

        // —— 唯一恢复路径：重新登录（本轮新语义；不是「解封复活旧会话」）——
        await rebuildSession()
        expect(tokens1!.accessToken).not.toBe(oldTokens.accessToken)

        const restored = await api.root('GET', api.apiPath('/system/user/lock/read'))
        expectOk(restored, 'device A restored after relogin')

        // 正对照：新会话下同一条路径确实会走到处理器 → 40401（证明上面那个 40101 是守卫拦的）
        const freshOnHandler = await api.root('GET', api.apiPath(`/system/device/${ghostRowId}`))
        expect(bodyOf(freshOnHandler).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
      }
      finally {
        // 兜底还原：断言中途炸掉时也要把「设备已解封 + 会话已重建」做掉；两个动作各自吞异常，
        // 免得兜底本身再抛一次、把原始失败盖掉。
        await unbanDevice().catch(() => undefined)
        await rebuildSession().catch(() => undefined)
      }
    })

    it('G8 设备 IP 变化回写：XFF 换 IP → 放行且 sys_device.ip 落新值；同 IP 再请求不重复写（updated_at 不变）', async () => {
      // 127.0.0.2 是本机回环段（is-localhost-ip → LOCAL），不触发外网地理 API，用例确定性
      const newIp = '127.0.0.2'

      const rowsBefore: Array<{ ip: string | null, updated_at: Date }> = await api.pgDataSource.query(
        'SELECT ip, updated_at FROM sys_device WHERE device_id = $1',
        [api.deviceId],
      )

      const first = await api.root(
        'GET',
        api.apiPath('/system/user/lock/read'),
        undefined,
        { 'x-forwarded-for': newIp },
      )
      expectOk(first, 'ip change request')

      const rowsAfter: Array<{ ip: string | null, updated_at: Date }> = await api.pgDataSource.query(
        'SELECT ip, updated_at FROM sys_device WHERE device_id = $1',
        [api.deviceId],
      )
      expect(rowsAfter[0].ip).toBe(newIp)
      expect(new Date(rowsAfter[0].updated_at).toISOString()).not.toBe(new Date(rowsBefore[0].updated_at).toISOString())

      // 同 IP 第二次：guard 读到缓存 currentIp 已等于 realIp（updateIpAndLocation 提交后
      // 回填缓存）→ 不再写库，updated_at 与 ip 均保持不变
      await new Promise(resolve => setTimeout(resolve, 20))
      const second = await api.root(
        'GET',
        api.apiPath('/system/user/lock/read'),
        undefined,
        { 'x-forwarded-for': newIp },
      )
      expectOk(second, 'same ip request')

      const rowsAgain: Array<{ ip: string | null, updated_at: Date }> = await api.pgDataSource.query(
        'SELECT ip, updated_at FROM sys_device WHERE device_id = $1',
        [api.deviceId],
      )
      expect(rowsAgain[0].ip).toBe(newIp)
      expect(new Date(rowsAgain[0].updated_at).toISOString()).toBe(new Date(rowsAfter[0].updated_at).toISOString())

      // 还原：无 XFF 的下一次请求把 IP 写回真实回环地址，避免污染后续用例的缓存/行状态
      const restoreRes = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expectOk(restoreRes, 'ip restore')
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
      tokens2 = await performHttpOpaqueLogin(api, app, fixture2)
      api.setAuth(tokens2)

      const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED)
    })

    it('种 verified 缓存（真实缓存通道）后 → 20000', async () => {
      await api.seedMfaVerifiedCache(fixture2!.userId)
      const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expectOk(res, 'mfa verified via device cache')
    })

    it('G12 payload mfaVerified=true 短路：服务端签发带该字段的 AT + 无设备缓存 → 20000', async () => {
      // 登录时 isTrusted=false → 正常 AT 的 mfaVerified=false；这里用服务端密钥重签
      // 同一会话的 payload（sid 不变 → JWT 会话键仍命中），只翻 mfaVerified 位，
      // 证明 mfa.guard 的 P6 短路只信 AT payload，与设备级 verified 缓存解耦。
      const jwtService = app.get(JwtService)
      const accessSecret = app.get(ConfigService).get<string>('jwt.access.secret')!

      const cacheMfa = app.get(AppTechCacheMfaService)
      await cacheMfa.delVerifiedCache(fixture2!.userId, api.deviceId)
      expect(await cacheMfa.getVerifiedCache(fixture2!.userId, api.deviceId)).toBeNull()

      const { iat: _iat, exp: _exp, ...payload } = jwtService.decode<Record<string, unknown>>(tokens2!.accessToken)
      const trustedAt = await jwtService.signAsync(
        { ...payload, mfaVerified: true },
        { secret: accessSecret, expiresIn: '5m' },
      )

      api.setAuth({ ...tokens2!, accessToken: trustedAt })
      const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
      expectOk(res, 'mfaVerified payload shortcut')
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

    async function clearLockCache() {
      const cacheService = app.get(AppTechCacheService)
      const lockKeys = WalnutAdminConstAppCacheKeys.SECURITY_LOCK
      await cacheService.del(`${lockKeys}:${fixture1!.userId}:global`)
      await cacheService.del(`${lockKeys}:${fixture1!.userId}:${api.deviceId}`)
    }

    it('G5 冷缓存：lock 后显式删 SECURITY_LOCK 键 → 缓存 miss 回源 DB 仍 40118（P1-20）', async () => {
      const lockRes = await api.root('PATCH', api.apiPath('/system/user/lock'), { lockRoute: { name: `g5-cold-${seed8}` } })
      expectOk(lockRes, 'lock for cold cache probe')

      await clearLockCache()

      const blocked = await api.root('GET', api.apiPath('/system/user/me/profile'))
      expect(bodyOf(blocked).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)

      // 回源 DB（lockCrossDevice 默认 true → 全局键）后缓存被回填
      const cached = await app.get(AppTechCacheService).get<boolean>(
        `${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${fixture1!.userId}:global`,
      )
      expect(cached).toBe(true)

      const unlockRes = await api.root('PATCH', api.apiPath('/system/user/lock/unlock'), {})
      expectOk(unlockRes, 'unlock after cold cache probe')
    })

    it('G5 跨设备：A 设备锁（默认 lockCrossDevice=true）→ B 设备客户端探针 40118', async () => {
      const lockRes = await api.root('PATCH', api.apiPath('/system/user/lock'), { lockRoute: { name: `g5-cross-${seed8}` } })
      expectOk(lockRes, 'lock device A')

      const blocked = await apiB!.root('GET', apiB!.apiPath('/system/user/me/profile'))
      expect(bodyOf(blocked).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)

      const unlockRes = await api.root('PATCH', api.apiPath('/system/user/lock/unlock'), {})
      expectOk(unlockRes, 'unlock device A')
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
      // location 风控缓存已由 describe 级 beforeAll 预写（P3-38），不会外连 api.ip.sb
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

    it('G14 无 IpFree 旁路：曾豁免 IP 的 4 个端点对已拉黑 IP 一律 40603（批次 8 / B3）', async () => {
      // 批次 8 / B3（2026-11）撤掉了全部 4 处 @WalnutAdminGuardIpFree()：
      //   security/sign/initial · security/sign/aes-key · system/locale/message/:locale
      //   · system/user/preference/read
      // 判据：IP 黑名单**没有中间件兜底**（guard 是唯一执行点），每个 IpFree 都是端点上
      // 显式放弃 IP 维度风控的缺口，而同族的匿名引导端点（device/initial · lang/list/public
      // · setting/public）一直没跳 IP 且工作正常 ⇒ 这 4 处没有存在理由。
      //
      // 负对照：把任意一处 @WalnutAdminGuardIpFree() 加回去，对应那条会变 20000/其它码而非
      // 40603 ⇒ 本用例红（改造前 /security/sign/initial 与 aes-key 就是 20000）。
      const ipService = app.get(SharedIpService)
      await ipService.addToTemporaryBlacklist(BANNED_IP_TEMP, 'GUARD_MATRIX_G14')
      try {
        const probes: Array<{ name: string, method: 'GET' | 'POST', path: string, body?: unknown }> = [
          { name: '对照（从未 IpFree）', method: 'GET', path: '/security/rsa/public-key' },
          { name: 'sign/initial', method: 'POST', path: '/security/sign/initial', body: { rsaPubKey: `g14-probe-${seed8}`, force: false } },
          { name: 'sign/aes-key', method: 'POST', path: '/security/sign/aes-key' },
          { name: 'locale/message', method: 'GET', path: '/system/locale/message/zh_CN' },
          { name: 'user/preference/read', method: 'GET', path: '/system/user/preference/read' },
        ]

        for (const probe of probes) {
          const res = await api.unsigned(
            probe.method,
            api.apiPath(probe.path),
            probe.body,
            { 'x-forwarded-for': BANNED_IP_TEMP },
          )

          expect(bodyOf(res).code, `${probe.name} 仍能绕过 IP 黑名单`).toBe(
            WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED,
          )
        }
      }
      finally {
        await ipService.removeFromTemporaryBlacklist(BANNED_IP_TEMP)
      }
    })

    it('黑名单路径命中：/w/v1/admin → 40610 + 自动永久拉黑（P1-11：strip API 前缀 + 中间件兜底未命中路由）', async () => {
      // 用独立伪造 IP 承载拉黑副作用（避免把 127.0.0.1 拉进永久黑名单污染后续用例）。
      // 未命中路由的请求不执行 guard 链 → 检查落在 BlacklistPathMiddleware（forRoutes('*')），
      // strip `/w/v1` 后按裸常量匹配 `/admin` → 拉黑 realIp + 40610。
      try {
        const res = await api.unsigned(
          'GET',
          api.apiPath('/admin'),
          undefined,
          {
            'x-forwarded-for': BANNED_IP_SCAN_PROBE,
            ...singleFactorHeaders({ method: 'GET', url: api.apiPath('/admin') }),
          },
        )
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BLACK_LIST_PATH_DETECTED)
      }
      finally {
        await app.get(SharedIpService).removeFromPermanentBlackList(BANNED_IP_SCAN_PROBE)
      }
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

    it('G7 defaultClosed + detailKey 缺失：google settings={} → 50301（区别于零配置缓存缺失）', async () => {
      // P1-17 的 defaultClosed 有两层缺失语义：① 整表/主键缺失（D 段已测）；② 主键存在但
      // detailKey（authEnable）缺失 —— 本用例补 ②：JSON 空对象经 getAppSettings 命中后
      // parsedMainData.authEnable === undefined → defaultClosed 分支 50301。
      const restore = await overrideAppSettings(app, {
        [WalnutAdminConstAppSettingKeys.APP_AUTH_GOOGLE]: JSON.stringify({}),
      })
      try {
        const res = await api.unsigned('POST', api.apiPath('/auth/google'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_ENDPOINT_DOWN)
      }
      finally {
        await restore()
      }
    })

    it('G7 opaque 子开关：authEnable=1 + register=0 → register/start 50301（主开关开、子开关关）', async () => {
      const restore = await overrideAppSettings(app, {
        [WalnutAdminConstAppSettingKeys.APP_AUTH_OPAQUE]: JSON.stringify({ authEnable: 1, register: 0 }),
      })
      try {
        const res = await api.root('POST', api.apiPath('/auth/opaque/user/register/start'), { start: 'g7-probe' })
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_ENDPOINT_DOWN)
      }
      finally {
        await restore()
      }
    })

    it('G7 opaque 子开关：authEnable=1 + change=0 → change-password/start 50301', async () => {
      const restore = await overrideAppSettings(app, {
        [WalnutAdminConstAppSettingKeys.APP_AUTH_OPAQUE]: JSON.stringify({ authEnable: 1, change: 0 }),
      })
      try {
        const res = await api.root('POST', api.apiPath('/auth/opaque/user/change-password/start'), { start: 'g7-probe' })
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_ENDPOINT_DOWN)
      }
      finally {
        await restore()
      }
    })
  })
})

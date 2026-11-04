import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import { createHash, randomBytes } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../helpers/api-client'
import { createApiApp } from '../helpers/create-api-app'
import { buildSignRaw, computeSingleFactorSign, generateNonce, WALNUT_TEST_USER_AGENT } from '../helpers/sign-handshake'
import { signCookieValue, unsignCookieValue } from '../helpers/signed-cookie'

/**
 * A 路 · Sign 家族（G3）拒绝面 —— 真实 HTTP 全链，每条断言 `body.code` 精确值 + 真实副作用
 * （Redis 键 / Set-Cookie / PG 行）。
 *
 * 与既有覆盖的分工（本文件**只补既有覆盖拿不到的**）：
 * - `platform/guard-matrix.api-spec.ts` 的 Sign 段：签名篡改 / X-Timestamp `-6min` 单侧 /
 *   nonce 重放 / 缺 ticket 自动签发；
 * - `libs/guards/src/guards/__tests__/sign.guard.spec.ts`：40113 只有 mock 缓存的单测。
 *
 * 本文件补的六条，构造它们都需要**真 cookie 签名**或**真 Redis 缓存通道**：
 * 1. 40113：删掉 aesKey 握手态、ticket 仍合法 ⇒ ExpiredSignature（与 40012「握手根本没做过」区分）；
 * 2. SIGN_TICKET cookie ≠ 缓存（helper 签的合法签名 + 服务端没见过的值）⇒ 40112，含「不带 `s:`
 *    前缀被整条丢弃 ⇒ 走续签」的机制对照组；
 * 3. ticket 过期（缓存键消失）⇒ guard 重签新 ticket，缓存与 cookie 同步，第二次请求 20000；
 * 4. 时间窗两侧：`+4m59s` 通过、`-5m01s` 拒绝（既有只有 `-6min` 单侧）；
 * 5. B5 旧形态 64hex DEVICE_ID：合法签名 ⇒ Device guard 40605（形态判据），同一枚值在
 *    DeviceFree 的 `/` 上 ⇒ 40012（说明它**真的被解析成了设备 id 字符串**，而不是被 cookie 层
 *    丢弃后变成「缺失」）—— 无签名的同一枚值 ⇒ 40112，两种拒绝原因因此可分。
 * 6. `APP_COOKIE_SECRET` 轮换后的自愈：`s:` 前缀 + 坏 HMAC 的 SIGN_TICKET 曾被 `isNil` 判不出来
 *    ⇒ 当成「与缓存不符」（本意 40112，实测在日志摘要 `secretDigest(false)` 处先炸成 50000）——
 *    两条都**没有自愈路径**；现在归一成「缺失」⇒ 重签 20000 + Set-Cookie。
 *    同块内的正对照守着另一半语义：签名**合法**但值与缓存不符仍是 40112 且无 Set-Cookie。
 *
 * 全部用例走**匿名单因子**（登录态会切双因子，与本文件无关）；破坏性动作自建自还原。
 */

/** B5 之前的设备 id 形态：64 位小写 hex（旧客户端 cookie 里的值）。现在是「签名合法、内容非法」样本 */
const B5_LEGACY_DEVICE_ID = 'b5'.repeat(32)

/** 时间容差（sign.guard.ts 的 TIMESTAMP_TOLERANCE_MS = 5min）两侧各留 1s 余量 */
const TIMESTAMP_INSIDE_MS = 4 * 60 * 1000 + 59 * 1000
const TIMESTAMP_OUTSIDE_MS = 5 * 60 * 1000 + 1000

describe('A 路 · Sign 家族：40113 握手态 / ticket 校验 / 时间窗边界 / B5 旧形态设备 id（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  /**
   * 第二设备客户端：40113 用例必须把某台设备的 aesKey 缓存删掉，而 `api-client` 不暴露
   * 「重握手 + 换本机 aesKey」的口子（aesKey 是私有字段）⇒ 删了就复原不了。
   * 用独立设备跑这条，主客户端的握手态全程完好。
   */
  let apiB: WalnutApiClient

  let cache: AppTechCacheService
  let cookieSecret: string
  let stripPrefixRegex: RegExp

  /** guard 侧的三个缓存键（与 AppTechCacheSignService / AppTechCacheRsaService 同口径） */
  const aesKeyKey = (deviceId: string) => `${WalnutAdminConstAppCacheKeys.SECURITY_SIGN_AES_KEY}:${deviceId}`
  const ticketKey = (deviceId: string) => `${WalnutAdminConstAppCacheKeys.SECURITY_SIGN_TICKET}:${deviceId}`
  const rsaKeyKey = (deviceId: string) => `${WalnutAdminConstAppCacheKeys.SECURITY_RSA_PUB_KEY}:${deviceId}`

  /**
   * CAP 验证缓存键（对照 `libs/cache/src/service/cap.cache.ts` 的 getCapTokenCacheKey：
   * `deviceId + token 指纹`）。换设备 id 就会 miss ⇒ CAP 抢在 Sign 前面 40117，测不到 Sign。
   */
  const capKey = (deviceId: string, capToken: string) => {
    const fingerprint = createHash('sha256').update(capToken, 'utf8').digest('hex').slice(0, 16)
    return `${WalnutAdminConstAppCacheKeys.SECURITY_CAP_TOKEN}:${deviceId}:${fingerprint}`
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    apiB = await WalnutApiClient.create(app)
    cache = app.get(AppTechCacheService)

    const configService = app.get(ConfigService)
    cookieSecret = configService.get<string>('app.cookie.secret')!
    stripPrefixRegex = new RegExp(
      `^/${configService.get<string>('app.api.prefix')}/v${configService.get<string>('app.api.version')}`,
    )

    // 首个成功请求把本设备的 CAP 验证缓存（键 = deviceId + token 指纹）落到真 Redis ——
    // 之后走完整 guard 链的请求都靠它，不必每轮重解 PoW
    expectOk(await api.anon('GET', api.apiPath('/')), 'warm-up: CAP 验证缓存落位')
  })

  afterAll(async () => {
    if (api !== undefined) {
      const pg = api.pgDataSource
      const deviceIds = [api.deviceId, apiB?.deviceId, B5_LEGACY_DEVICE_ID]
        .filter((id): id is string => typeof id === 'string' && id.length > 0)

      for (const deviceId of deviceIds) {
        await pg.query('DELETE FROM sys_device WHERE device_id = $1', [deviceId])
      }

      // 两个客户端设备 + B5 假设备的全部 WALNUT_CACHE_* 键（aesKey / ticket / rsa / cap / device）
      await api.cleanupWalnutCacheKeys(...deviceIds)
    }

    await app?.close()
  })

  /** 手工单因子签名头（匿名态）：时间戳 / nonce 可注入，其余按 sign.guard 的原文规则现算 */
  function signHeaders(opts: { url: string, timestamp?: number, nonce?: string }): Record<string, string> {
    const timestamp = opts.timestamp ?? Date.now()
    const nonce = opts.nonce ?? generateNonce()
    const raw = buildSignRaw({
      method: 'GET',
      routePath: opts.url.replace(stripPrefixRegex, '') || '/',
      body: undefined,
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

  /** 从响应的 Set-Cookie 里挑出某键的**裸值**（去掉属性段），用于与缓存值比对 */
  function cookieValueFromResponse(res: SuperTestResponse, key: string): string | undefined {
    const setCookies = (res.headers['set-cookie'] ?? []) as unknown as string[]
    const raw = setCookies.find(item => item.startsWith(`${key}=`))
    return raw?.split(';')[0].slice(key.length + 1)
  }

  // ============================================================
  // 0. helper 自检：真 app 的 cookie 校验中间件必须收下 helper 签的值
  // ============================================================
  describe('signed-cookie helper 自检（真 cookie-parser 中间件）', () => {
    it('helper 签出的 SIGN_TICKET 被服务端接受（解签名后与缓存逐字节相同）⇒ 20000', async () => {
      const cachedTicket = await cache.get<string>(ticketKey(api.deviceId))
      expect(typeof cachedTicket).toBe('string')
      expect(cachedTicket).toBeTruthy()

      const signed = signCookieValue(cookieSecret, cachedTicket!)
      // 往返自洽：'s:' 前缀 + '.' 分隔 + 去尾 '=' 的 base64 三段都得对得上
      expect(unsignCookieValue(signed)).toBe(cachedTicket)

      const saved = api.getCookie(WalnutAdminConstCookieKeys.SIGN_TICKET)!
      api.setCookie(WalnutAdminConstCookieKeys.SIGN_TICKET, signed)
      try {
        // 服务端比对的是「cookie 解签名后的字符串 vs 缓存值」⇒ 只有逐字节一致才可能 20000。
        // 算法差一处（少 s: / 分隔符不对 / base64 尾部 '=' 没去）都会被 cookie-parser 判成
        // false，于是走「ticket 失配」40112 —— 这条用例就是 helper 的验收判据。
        expectOk(await api.anon('GET', api.apiPath('/')), 'helper-signed ticket accepted')
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.SIGN_TICKET, saved)
      }
    })
  })

  // ============================================================
  // 1. ticket cookie ≠ 缓存（40112）与「缺 s: 前缀被丢弃」的机制对照
  // ============================================================
  describe('Sign guard：SIGN_TICKET cookie 与缓存失配', () => {
    it('签名合法但内容不同 ⇒ 40112，且不触发续签 Set-Cookie（失配在快速路径直接抛）', async () => {
      const cachedTicket = await cache.get<string>(ticketKey(api.deviceId))
      expect(cachedTicket).toBeTruthy()

      // 合法签名 + 服务端从未见过的 ticket —— 只有 helper 能造出这种 cookie。
      // 不带 s: 前缀的版本会被 cookie-parser 整条丢弃，走的是下一条的续签路径。
      const foreign = signCookieValue(cookieSecret, randomBytes(16).toString('base64url'))
      expect(unsignCookieValue(foreign)).not.toBe(cachedTicket)

      const saved = api.getCookie(WalnutAdminConstCookieKeys.SIGN_TICKET)!
      api.setCookie(WalnutAdminConstCookieKeys.SIGN_TICKET, foreign)
      try {
        const res = await api.anon('GET', api.apiPath('/'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)
        // 副作用：失配在「缓存存在」的快速路径里直接抛出，续签那两行一行都没跑 ⇒ 没有 ticket 的 Set-Cookie
        expect(cookieValueFromResponse(res, WalnutAdminConstCookieKeys.SIGN_TICKET)).toBeUndefined()
        // 缓存没被写坏
        expect(await cache.get<string>(ticketKey(api.deviceId))).toBe(cachedTicket)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.SIGN_TICKET, saved)
      }
    })

    it('对照：同值但**不带 s: 前缀** ⇒ 被 signedCookies 整条丢弃 ⇒ 走「缺失」续签（20000 + Set-Cookie）', async () => {
      const cachedTicket = await cache.get<string>(ticketKey(api.deviceId))
      expect(cachedTicket).toBeTruthy()

      const saved = api.getCookie(WalnutAdminConstCookieKeys.SIGN_TICKET)!
      api.setCookie(WalnutAdminConstCookieKeys.SIGN_TICKET, cachedTicket!)
      try {
        const res = await api.anon('GET', api.apiPath('/'))
        // 值本身是对的，但形态不是 s:<value>.<hmac> ⇒ cookie-parser 的 signedCookies 里根本没有这个键
        // ⇒ guard 视同「缺失」⇒ 续签（与上一条的 40112 形成机制对照：缺 ≠ 错）
        expectOk(res, 'unsigned ticket treated as missing')

        const renewed = cookieValueFromResponse(res, WalnutAdminConstCookieKeys.SIGN_TICKET)
        expect(renewed).toBeTruthy()
        expect(unsignCookieValue(renewed!)).toBe(cachedTicket)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.SIGN_TICKET, saved)
      }
    })
  })

  // ============================================================
  // 2. 40113：握手态 aesKey 被删（既有只有 mock 单测）
  // ============================================================
  describe('Sign guard：aesKey 握手态缺失（40113）', () => {
    it('删掉 aesKey 缓存、ticket 仍合法 ⇒ 40113 ExpiredSignature（不是 40112，也不是 40012）', async () => {
      // 正对照：同一请求在握手态完整时是 20000（也顺手把 apiB 的 CAP 缓存落位）
      expectOk(await apiB.anon('GET', apiB.apiPath('/')), 'apiB handshake intact')

      // 只删 aesKey，RSA 公钥留在缓存里 —— 「签名过期」与「握手根本没做过」（40012）是两种语义
      await cache.del(aesKeyKey(apiB.deviceId))
      expect(await cache.get<string>(aesKeyKey(apiB.deviceId))).toBeNull()
      expect(await cache.get<string>(rsaKeyKey(apiB.deviceId))).toBeTruthy()

      const res = await apiB.anon('GET', apiB.apiPath('/'))
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_EXPIRED_SIGNATURE)

      // 副作用 ①：guard 在第 7 步（ticket 续签）已经写了 Set-Cookie，第 8 步（取 aesKey）才抛
      // —— 证明 40113 出在 aesKey 这一步，不是更靠前的 ticket/时间戳/nonce
      expect(cookieValueFromResponse(res, WalnutAdminConstCookieKeys.SIGN_TICKET)).toBeTruthy()
      // 副作用 ②：缺失的 aesKey 不会被这次请求补回来（只有 POST /security/sign/aes-key 能写）
      expect(await cache.get<string>(aesKeyKey(apiB.deviceId))).toBeNull()
    })
  })

  // ============================================================
  // 3. ticket 过期 ⇒ 重签（既有只覆盖「缺 cookie + 清缓存」）
  // ============================================================
  describe('Sign guard：SIGN_TICKET 过期后的重签', () => {
    it('ticket 缓存消失（模拟 TTL 到期）⇒ 重签新 ticket（缓存与 cookie 同步），第二次请求 20000', async () => {
      const oldCookie = api.getCookie(WalnutAdminConstCookieKeys.SIGN_TICKET)!
      const oldTicket = await cache.get<string>(ticketKey(api.deviceId))
      expect(oldTicket).toBeTruthy()

      await cache.del(ticketKey(api.deviceId))
      expect(await cache.get<string>(ticketKey(api.deviceId))).toBeNull()

      const first = await api.anon('GET', api.apiPath('/'))
      expectOk(first, 'request after ticket expiry')

      const renewedRaw = cookieValueFromResponse(first, WalnutAdminConstCookieKeys.SIGN_TICKET)
      expect(renewedRaw).toBeTruthy()
      const renewed = unsignCookieValue(renewedRaw!)!
      expect(renewed).not.toBe(oldTicket)
      // 副作用：缓存里落的就是新签发的值（cookie 与缓存同源，不是各写各的）
      expect(await cache.get<string>(ticketKey(api.deviceId))).toBe(renewed)
      // 旧 cookie 确实换掉了（jar 已捕获 Set-Cookie 的新值）
      expect(unsignCookieValue(oldCookie)).not.toBe(renewed)
      expect(unsignCookieValue(api.getCookie(WalnutAdminConstCookieKeys.SIGN_TICKET)!)).toBe(renewed)

      // 续签后可继续用：第二次请求（jar 里的新 ticket）20000
      expectOk(await api.anon('GET', api.apiPath('/')), 'second request with renewed ticket')
    })
  })

  // ============================================================
  // 4. 时间窗两侧边界（既有只有 -6min 单侧）
  // ============================================================
  describe('Sign guard：X-Timestamp 5min 容差两侧边界', () => {
    it('+4m59s（窗口内）⇒ 20000', async () => {
      const future = Date.now() + TIMESTAMP_INSIDE_MS
      const res = await api.unsigned(
        'GET',
        api.apiPath('/'),
        undefined,
        signHeaders({ url: api.apiPath('/'), timestamp: future }),
      )
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
    })

    it('-5m01s（窗口外）⇒ 40112，且时间戳校验先于 nonce 记录（该 nonce 未被消费）', async () => {
      const past = Date.now() - TIMESTAMP_OUTSIDE_MS
      const nonce = generateNonce()
      const res = await api.unsigned(
        'GET',
        api.apiPath('/'),
        undefined,
        signHeaders({ url: api.apiPath('/'), timestamp: past, nonce }),
      )
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)
      // 副作用：nonce 未被落库（validateTimestamp 在 validateAndRecordNonce 之前）
      expect(await cache.get<string>(`${WalnutAdminConstAppCacheKeys.SECURITY_SIGN_NONCE}:${nonce}`)).toBeNull()
    })
  })

  // ============================================================
  // 5. B5 旧形态 64hex DEVICE_ID：两种拒绝原因可分
  // ============================================================
  describe('B5：旧形态 64hex DEVICE_ID（Device guard 40605 vs 签名缺失 40112）', () => {
    it('helper 签的合法签名 + 64hex ⇒ Device guard 40605，且该 id 不落任何设备行', async () => {
      const saved = api.getCookie(WalnutAdminConstCookieKeys.DEVICE_ID)!
      api.setCookie(WalnutAdminConstCookieKeys.DEVICE_ID, signCookieValue(cookieSecret, B5_LEGACY_DEVICE_ID))
      try {
        // Device guard 是第 3 位（IP → Security → Device），先于 Risk/CAP/JWT ⇒ 直接 40605
        const res = await api.anon('GET', api.apiPath('/system/user/lock/read'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)
        // 副作用：形态判据在**进任何身份逻辑之前**就拒掉，库里不会多出一行「旧形态设备」
        const rows: Array<{ id: string }> = await api.pgDataSource.query(
          'SELECT id FROM sys_device WHERE device_id = $1',
          [B5_LEGACY_DEVICE_ID],
        )
        expect(rows).toHaveLength(0)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.DEVICE_ID, saved)
      }
    })

    it('同一枚 64hex + 合法签名，在 DeviceFree 的 / 上 ⇒ 40012（值被当成设备 id 用 ⇒ 查握手缓存），证明它没被 cookie 层丢弃', async () => {
      // CAP 的验证缓存键掺 deviceId，换 id 必 miss ⇒ CAP 会抢在 Sign 前面 40117，测不到 Sign。
      // 这里按 AppTechCacheCapService 的真实键格式给这台「假设备」预写一条已验收态
      // （与 guard-matrix 预写 risk location 缓存同一手法：走生产同一缓存通道，不 mock guard）。
      const capToken = unsignCookieValue(api.getCookie(WalnutAdminConstCookieKeys.CAPJS_TOKEN)!)!
      await cache.set(capKey(B5_LEGACY_DEVICE_ID, capToken), true, {
        t: WalnutAdminConstAppCacheType.AUTH,
        ttl: 60,
      })

      const saved = api.getCookie(WalnutAdminConstCookieKeys.DEVICE_ID)!
      api.setCookie(WalnutAdminConstCookieKeys.DEVICE_ID, signCookieValue(cookieSecret, B5_LEGACY_DEVICE_ID))
      try {
        // / 是 DeviceFree（不进 Device guard）但**不** SignFree ⇒ 请求会走到 Sign guard：
        // 签名合法 ⇒ signedCookies 里拿到的是那串 64hex 字符串 ⇒ 取 RSA 公钥缓存 miss ⇒ 40012。
        // 若签名不合法（或没带 s: 前缀），sign guard 拿到的是 false/undefined，第 3 步就 40112。
        const res = await api.unsigned(
          'GET',
          api.apiPath('/'),
          undefined,
          signHeaders({ url: api.apiPath('/') }),
        )
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_RSA_PUB_KEY_NOT_FOUND)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.DEVICE_ID, saved)
      }
    })

    it('对照：同一枚 64hex 但**不带签名** ⇒ 从 signedCookies 整条消失 ⇒ Sign guard 视同缺 DEVICE_ID ⇒ 40112', async () => {
      const saved = api.getCookie(WalnutAdminConstCookieKeys.DEVICE_ID)!
      api.setCookie(WalnutAdminConstCookieKeys.DEVICE_ID, B5_LEGACY_DEVICE_ID)
      try {
        const res = await api.unsigned(
          'GET',
          api.apiPath('/'),
          undefined,
          signHeaders({ url: api.apiPath('/') }),
        )
        // 没有 s: 前缀的值 cookie-parser 不收录进 signedCookies ⇒ extractRequestMetadata 判「缺 deviceId」
        // ⇒ 40112。与上一条的 40012 一起，「签名合法但内容非法」与「签名坏→缺失」两条路径可分。
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.DEVICE_ID, saved)
      }
    })
  })

  // ============================================================
  // 6. APP_COOKIE_SECRET 轮换后的自愈：坏签名 = 缺失（不是失配）
  // ============================================================
  describe('Sign guard：SIGN_TICKET 坏签名（APP_COOKIE_SECRET 轮换）⇒ 重签自愈', () => {
    it('s: 前缀 + 坏 HMAC（模拟轮换后的旧 cookie）⇒ 20000 + Set-Cookie 重签，不是 40112', async () => {
      const cachedTicket = await cache.get<string>(ticketKey(api.deviceId))
      expect(typeof cachedTicket).toBe('string')
      expect(cachedTicket).toBeTruthy()

      // 值就是缓存里那枚合法 ticket，只是用**换过的 secret** 签的 —— APP_COOKIE_SECRET 轮换后
      // 旧客户端手里的 cookie 正是这个形态。cookie-parser 验签失败 ⇒ signedCookies 里是 false
      // （不是 undefined）。裸 getWalnutAdminCookie 取到 false ⇒ isNil(false) === false ⇒ 进
      // 「与缓存不符」分支（本意 40112，实际先在该分支的 secretDigest(false) 炸成 50000），而缓存里
      // ticket 还在 ⇒ 重签腿永远走不到 ⇒ 只能人工清 cookie。这条断言的就是「现在能自愈」。
      const rotated = signCookieValue(`${cookieSecret}-rotated`, cachedTicket!)
      expect(unsignCookieValue(rotated)).toBe(cachedTicket)

      const saved = api.getCookie(WalnutAdminConstCookieKeys.SIGN_TICKET)!
      api.setCookie(WalnutAdminConstCookieKeys.SIGN_TICKET, rotated)
      try {
        const res = await api.anon('GET', api.apiPath('/'))
        expectOk(res, 'bad-signature ticket treated as missing ⇒ re-sign')

        // 自愈的判据不是「这次没报错」，而是服务端真发了一枚**能验签**的 cookie（值 = 缓存里那枚）
        const renewed = cookieValueFromResponse(res, WalnutAdminConstCookieKeys.SIGN_TICKET)
        expect(renewed).toBeTruthy()
        expect(unsignCookieValue(renewed!)).toBe(cachedTicket)
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.SIGN_TICKET, saved)
      }
    })

    it('正对照：签名合法但值与缓存不符 ⇒ 仍 40112 且无 Set-Cookie（失配语义不被自愈削弱）', async () => {
      const cachedTicket = await cache.get<string>(ticketKey(api.deviceId))
      expect(cachedTicket).toBeTruthy()

      // 与上一条的差别只有一处：HMAC 是**真 secret** 签的 ⇒ cookie-parser 解得出字符串 ⇒
      // guard 拿到的不是「缺失」而是「另一个值」，必须按失配拒绝（否则坏签名自愈会顺手放行伪造值）。
      const foreign = signCookieValue(cookieSecret, randomBytes(16).toString('base64url'))
      expect(unsignCookieValue(foreign)).not.toBe(cachedTicket)

      const saved = api.getCookie(WalnutAdminConstCookieKeys.SIGN_TICKET)!
      api.setCookie(WalnutAdminConstCookieKeys.SIGN_TICKET, foreign)
      try {
        const res = await api.anon('GET', api.apiPath('/'))
        expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)
        // 失配在「缓存存在」的快速路径里直接抛 ⇒ 没有重签的 Set-Cookie
        expect(cookieValueFromResponse(res, WalnutAdminConstCookieKeys.SIGN_TICKET)).toBeUndefined()
      }
      finally {
        api.setCookie(WalnutAdminConstCookieKeys.SIGN_TICKET, saved)
      }
    })
  })
})

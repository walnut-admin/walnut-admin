import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse, Test } from 'supertest'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { getDataSourceToken } from '@nestjs/typeorm'
import { AppTechCacheMfaService, AppTechRedisService } from '@walnut-server/cache'
import { WalnutPGConnectionName } from '@walnut-server/db'
import supertest from 'supertest'

import { getWalnutPgAdminDataSource } from '../../integration/helpers/create-integration-app'
import {
  buildSignRaw,
  computeDualFactorSign,
  computeSingleFactorSign,
  decryptAesKeyEnvelope,
  deriveApiSignKey,
  generateClientRsaKeyPair,
  generateNonce,
  solveCapChallenge,
  WALNUT_TEST_USER_AGENT,
} from './sign-handshake'

/**
 * API 级测试的 supertest 客户端封装：`create()` 自动完成「设备登记 → CAP → 签名握手」
 * 真实三步引导，此后每个请求按 sign.guard 规则现算 HMAC（未登录单因子 / 已登录双因子），
 * 并用手工 cookie jar 在请求间回传服务端签发的签名 cookie（DEVICE_ID / SIGN_TICKET /
 * CAPJS_TOKEN / RT_JTI —— 服务端 cookie 全部 signed，值里已带签名，原样回传即可）。
 *
 * 双形态：
 * - `anon(...)`：无 Authorization，单因子签名（opaque 登录、公开冒烟）；
 * - `root(...)`：带 `setAuth()` 注入的 AT（Authorization: Bearer）+ 双因子签名。
 *
 * `unsigned(...)` 保留一条不发签名头的通路（sign-free 引导端点与缺头负路径）。
 */
export interface WalnutAuthTokens {
  userId: string
  userName: string
  accessToken: string
  sessionKey: string
}

type WalnutHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

interface ExecuteOptions {
  method: WalnutHttpMethod
  /** 完整路径（含 `/{prefix}/v{version}` 前缀与 query 串） */
  url: string
  body?: unknown
  headers?: Record<string, string>
  /** false = 不发签名头；true = 按 auth 状态现算 HMAC */
  sign?: boolean
}

export class WalnutApiClient {
  private readonly cookies = new Map<string, string>()
  private readonly rsaPrivateKey: string
  private auth: WalnutAuthTokens | null = null

  private aesKey = ''
  private hkdfInfo = ''
  private _deviceId = ''

  private constructor(
    private readonly app: NestExpressApplication,
    private readonly configService: ConfigService,
    readonly fingerprint: string,
    rsaPrivateKey: string,
  ) {
    this.rsaPrivateKey = rsaPrivateKey
  }

  get deviceId(): string {
    return this._deviceId
  }

  /**
   * 握手期提交给服务端的客户端 RSA 私钥（PEM）—— `EncryptResponse` 端点（如
   * `GET /auth/keys`、`GET /shared/ali/sts`）的响应加密字段用它走
   * `decryptAesKeyEnvelope` 还原明文（与 aes-key 握手第二步同一信封格式）。
   */
  get clientRsaPrivateKeyPem(): string {
    return this.rsaPrivateKey
  }

  private get apiPrefix(): string {
    return this.configService.get<string>('app.api.prefix')!
  }

  private get apiVersion(): string {
    return this.configService.get<string>('app.api.version')!
  }

  /** `/{prefix}/v{version}` 前缀拼接（与 create-api-app 的 apiPath 同口径） */
  apiPath(url: string): string {
    return `/${this.apiPrefix}/v${this.apiVersion}${url}`
  }

  /** 对照 sign.guard buildSignRaw 的路径规范化：去掉 API 前缀与版本 */
  private stripApiPrefix(url: string): string {
    return url.replace(new RegExp(`^/${this.apiPrefix}/v${this.apiVersion}`), '') || '/'
  }

  /**
   * 创建客户端并完成真实三步引导：
   * 1. `POST /system/device/initial`（sign-free）→ DEVICE_ID cookie + 设备缓存；
   * 2. CAP challenge → 本地 PoW 求解 → redeem → CAPJS_TOKEN cookie（后续非 free 端点的
   *    CAP guard 硬校验依赖它 —— risk 有评估结果时缺 token 一律 40116/40117）；
   * 3. `POST /security/sign/initial` 提交客户端 RSA 公钥 → `POST /security/sign/aes-key`
   *    拿被该公钥加密的 aesKey → 客户端私钥解密。此后签名可用。
   */
  static async create(app: NestExpressApplication): Promise<WalnutApiClient> {
    const configService = app.get(ConfigService)
    const fingerprint = randomUUID()
    const { publicKeyPem, privateKeyPem } = generateClientRsaKeyPair()

    const client = new WalnutApiClient(app, configService, fingerprint, privateKeyPem)

    // 1. 设备登记（deviceId 从响应体取 —— cookie 值带签名前缀不宜反解）
    const deviceRes = await client.execute({
      method: 'POST',
      url: client.apiPath('/system/device/initial'),
      body: {
        deviceName: `api-spec-${fingerprint.slice(0, 8)}`,
        deviceInfo: {},
        hardwareInfo: {},
        sr: { height: 1080, width: 1920 },
        vp: { height: 900, width: 1600 },
        private: false,
      },
    })
    expectOk(deviceRes, 'device initial')
    client._deviceId = bodyOf<{ deviceId: string }>(deviceRes).data.deviceId

    // 2. CAP：challenge → 本地求解 → redeem（服务端种 CAPJS_TOKEN cookie）
    const challengeRes = await client.execute({
      method: 'POST',
      url: client.apiPath('/security/cap/challenge'),
    })
    // challenge 也是 FreeResponse（无统一响应壳），body 即 cap.js 的 { challenge, token, expires }
    const challengeBody = challengeRes.body as {
      challenge: { c: number, s: number, d: number }
      token: string
      expires: number
    }
    const solutions = solveCapChallenge(challengeBody.challenge, challengeBody.token)

    const redeemRes = await client.execute({
      method: 'POST',
      url: client.apiPath('/security/cap/redeem'),
      body: { token: challengeBody.token, solutions },
    })
    // redeem 是 FreeResponse（无统一响应壳），body 即 cap.js 的 { success, token?, expires? }
    const redeemBody = redeemRes.body as { success?: boolean, message?: string }
    if (redeemBody.success !== true) {
      throw new Error(`[api-client] cap redeem failed: ${JSON.stringify(redeemBody)}`)
    }

    // 3. 签名握手
    const initialRes = await client.execute({
      method: 'POST',
      url: client.apiPath('/security/sign/initial'),
      body: { rsaPubKey: publicKeyPem, force: false },
    })
    expectOk(initialRes, 'sign initial')

    const aesKeyRes = await client.execute({
      method: 'POST',
      url: client.apiPath('/security/sign/aes-key'),
    })
    expectOk(aesKeyRes, 'sign aes-key')

    const aesKeyData = bodyOf<{ aesKey: string, hkdfInfo: string }>(aesKeyRes).data
    client.aesKey = decryptAesKeyEnvelope(privateKeyPem, aesKeyData.aesKey)
    client.hkdfInfo = aesKeyData.hkdfInfo

    return client
  }

  /** 注入/清除登录态（auth-login 助手在 HTTP 登录成功后调用） */
  setAuth(auth: WalnutAuthTokens | null): void {
    this.auth = auth
  }

  /**
   * 【F 段 guard 矩阵】直接操纵 cookie jar：种篡改值 / 删指定 cookie（负路径用）。
   * jar 里存的是服务端签发的 signed cookie 原值；种入篡改值后 cookie-parser 验签失败，
   * 服务端 `req.signedCookies[key]` 为 false —— 与「cookie 缺失」同形的检出通路。
   */
  setCookie(key: string, value: string): void {
    this.cookies.set(key, value)
  }

  /** 【F 段 guard 矩阵】从 jar 删除指定 cookie（负路径：缺 DEVICE_ID / CAPJS_TOKEN 等） */
  dropCookie(key: string): void {
    this.cookies.delete(key)
  }

  /** 【F 段 guard 矩阵】读 jar 当前值（删除/篡改前快照，用后还原） */
  getCookie(key: string): string | undefined {
    return this.cookies.get(key)
  }

  /** 【F 段 guard 矩阵】握手期协商的 aesKey（手工构造「故意错误/重放」签名时复用同一设备密钥） */
  get handshakeAesKey(): string {
    return this.aesKey
  }

  getAuth(): WalnutAuthTokens | null {
    return this.auth
  }

  /** 已登录请求（双因子签名 + Authorization）；extraHeaders 供 guard 矩阵定制请求头（如 XFF） */
  async root(method: WalnutHttpMethod, url: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<SuperTestResponse> {
    if (this.auth === null) {
      throw new Error('[api-client] root() requires setAuth() first')
    }
    return this.execute({ method, url, body, sign: true, headers: { Authorization: `Bearer ${this.auth.accessToken}`, ...extraHeaders } })
  }

  /** 匿名请求（单因子签名，无 Authorization） */
  async anon(method: WalnutHttpMethod, url: string, body?: unknown): Promise<SuperTestResponse> {
    return this.execute({ method, url, body, sign: true })
  }

  /** 原始请求：不签名（sign-free 引导端点与缺头负路径） */
  async unsigned(method: WalnutHttpMethod, url: string, body?: unknown, headers?: Record<string, string>): Promise<SuperTestResponse> {
    return this.execute({ method, url, body, sign: false, headers })
  }

  /** 登录后给 MFA guard 用的设备级 verified 缓存（服务真实缓存通道，fixture 手法同 B7c） */
  async seedMfaVerifiedCache(userId: string): Promise<void> {
    await this.app.get(AppTechCacheMfaService).setVerifiedCache(userId, this.deviceId)
  }

  /** SCAN 清理本轮落到真实 Redis 的 WALNUT_CACHE_* 键（按 seed 片段匹配，B7c 同款手法） */
  async cleanupWalnutCacheKeys(...fragments: string[]): Promise<void> {
    const redis = this.app.get(AppTechRedisService).getClient()
    for (const fragment of fragments) {
      const keys: string[] = []
      for await (const key of redis.scanIterator({ MATCH: `WALNUT_CACHE_*${fragment}*`, COUNT: 200 })) {
        keys.push(...key)
      }
      if (keys.length > 0) {
        await redis.del(keys)
      }
    }
  }

  /**
   * 清掉无 seed 片段的固定缓存键（响应缓存装饰器跨轮共享，lang/locale/area spec 用）。
   * 入参是逻辑键（与 hasWalnutCacheKey 同口径）；AppTechCacheService 落 Redis 时统一加
   * `WALNUT_CACHE_` 前缀，这里删除前必须补上，否则 DEL 是静默 no-op（B 段 area spec 抓出：
   * 层级缓存跨轮残留会让相邻 suite 的 feedback 拿到串台数据）。
   */
  async cleanupFixedCacheKeys(...keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return
    }
    const redis = this.app.get(AppTechRedisService).getClient()
    await redis.del(keys.map(key => (key.startsWith('WALNUT_CACHE') ? key : `WALNUT_CACHE_${key}`)))
  }

  /** 断言用：WALNUT_CACHE_<key> 是否存在（响应缓存路径验证） */
  async hasWalnutCacheKey(key: string): Promise<boolean> {
    const redis = this.app.get(AppTechRedisService).getClient()
    const value = await redis.get(`WALNUT_CACHE_${key}`)
    return value !== null
  }

  /** 断言用：WALNUT_CACHE_<key> 剩余 TTL（秒；-1 永不过期 / -2 键不存在） */
  async getWalnutCacheTtl(key: string): Promise<number> {
    const redis = this.app.get(AppTechRedisService).getClient()
    return redis.ttl(key.startsWith('WALNUT_CACHE') ? key : `WALNUT_CACHE_${key}`)
  }

  /**
   * 测试 fixture / 清理用的 **管理通道** DataSource（DATABASE_PG_USER，天然绕 RLS）。
   * 运行时应用仍以 walnut_app 连接，RLS 在 HTTP 路径上正常生效；需要验证 RLS 的
   * 专项用例请直接用 `getWalnutPgDataSource(app)`。
   */
  get pgDataSource(): DataSource {
    return getWalnutPgAdminDataSource(this.app)
  }

  /**
   * 应用连接（walnut_app）—— 只给**豁免表** fixture 用（如 app_key 并发轮换的种子行，
   * 需要与应用事务走同一角色/可见性）；注册表 fixture 一律用 `pgDataSource`（管理通道）。
   */
  get appDataSource(): DataSource {
    return this.app.get<DataSource>(getDataSourceToken(WalnutPGConnectionName))
  }

  /** 核心执行器：签名头 + cookie jar + UA/fingerprint */
  private async execute(opts: ExecuteOptions): Promise<SuperTestResponse> {
    const headers: Record<string, string> = {
      'user-agent': WALNUT_TEST_USER_AGENT,
      'X-Fingerprint': this.fingerprint,
      ...opts.headers,
    }

    if (opts.sign) {
      if (this.aesKey === '') {
        throw new Error('[api-client] handshake incomplete: aesKey missing')
      }
      const timestamp = Date.now()
      const nonce = generateNonce()
      const raw = buildSignRaw({
        method: opts.method,
        routePath: this.stripApiPrefix(opts.url),
        body: opts.body,
        timestamp,
        nonce,
        ua: WALNUT_TEST_USER_AGENT,
      })

      const sign = this.auth !== null
        ? computeDualFactorSign(raw, deriveApiSignKey(this.auth.sessionKey, this.aesKey, this.hkdfInfo))
        : computeSingleFactorSign(raw, this.aesKey)

      headers['X-Sign'] = sign
      headers['X-Timestamp'] = String(timestamp)
      headers['X-Nonce'] = nonce
    }

    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    }

    const base = supertest(this.app.getHttpServer())
    let test: Test
    switch (opts.method) {
      case 'GET':
        test = base.get(opts.url)
        break
      case 'POST':
        test = base.post(opts.url)
        break
      case 'PUT':
        test = base.put(opts.url)
        break
      case 'DELETE':
        test = base.delete(opts.url)
        break
      case 'PATCH':
        test = base.patch(opts.url)
        break
    }

    if (opts.body !== undefined) {
      test = test.send(opts.body as object)
    }
    for (const [key, value] of Object.entries(headers)) {
      test = test.set(key, value)
    }

    const res = await test
    this.captureCookies(res)
    return res
  }

  /** 回写 cookie jar（signed cookie 值原样回传，cookie-parser 会在服务端验签） */
  private captureCookies(res: SuperTestResponse): void {
    const setCookies = res.headers['set-cookie'] as unknown as string[] | undefined
    if (!setCookies) {
      return
    }
    for (const raw of setCookies) {
      const [pair] = raw.split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) {
        this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1))
      }
    }
  }
}

/** 统一响应壳 `{ code, data, msg?, requestId?, meta? }` 的类型化取值（supertest 的 body 是 any） */
export interface WalnutAdminResponseBody<T = Record<string, unknown>> {
  code: number
  data: T
  msg?: string
  requestId?: string
  /**
   * 批次 8 / B2：成功响应也开始可能带 `meta`（`{ riskDegraded }` —— 风控不可用但端点不敏感时
   * 的降级留痕）。字段来自 `libs/utils/src/response.ts` 的响应壳，缺省不出现。
   */
  meta?: Record<string, unknown>
}

export function bodyOf<T = Record<string, unknown>>(res: SuperTestResponse): WalnutAdminResponseBody<T> {
  return res.body as WalnutAdminResponseBody<T>
}

/** 成功断言的小工具：body.code 必须是 20000（响应形态统一 HTTP 200 + 业务码） */
export function expectOk(res: SuperTestResponse, what: string): void {
  const body = bodyOf(res)
  if (body.code !== 20000) {
    throw new Error(`[api-client] ${what} failed: HTTP ${res.status} body=${JSON.stringify(body)}`)
  }
}

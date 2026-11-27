/**
 * 协议客户端：**在 Node 里以真实协议访问后端**（设备登记 → CAP → 签名握手 → OPAQUE 登录 →
 * 双因子签名请求）。移植自 `apps/server/apps/api/test/api/helpers/{api-client,auth-login}.ts`，
 * 区别只有传输层：那边是 supertest 直打 Nest 实例，这里是 fetch 打**真实进程**（dist-stage）。
 *
 * 用途（本批）：
 * - stack.setup：把 admin 的 TOTP **真实绑定**（generate → bind → verify(trusted=true)）；
 * - 设备用例：root 经 **admin API** 封禁 / 锁定设备（PATCH /system/device/:id/ban|lock）；
 * - user-crud 冒烟：root 造/改/查/删用户（断言业务码与列表）。
 *
 * 为什么不用浏览器 `page.evaluate` 调 fetch：业务请求要签名头，签名由 axios 拦截器在浏览器
 * 里现算；页面上下文里拿不到 AppAxios 实例，而重放在页面里签又会绕过「协议客户端」这层
 * 可断言的真源。Node 侧走同一份 sign-raw 纯函数（@walnut/utils/sign-raw）才有意义。
 */
import type { EndpointData, HttpMethod } from './api-types.ts'
import { randomUUID } from 'node:crypto'
import * as opaque from '@serenity-kit/opaque'
import { generateSync } from 'otplib'
import {
  BACKEND_API_BASE,
  BACKEND_ORIGIN,
} from '../../scripts/env.ts'
import { uniqueLocalIp } from '../device-fixtures.ts'
import {
  AuthRoutes,
  SecurityRoutes,
  SystemEndpointRoutes,
  WalnutAdminConstAppResponseCode,
} from './contract.ts'
import { buildSignRaw, splitPathAndQuery } from './sign-raw.ts'
import {
  computeDualFactorSign,
  computeSingleFactorSign,
  decryptAesKeyEnvelope,
  deriveApiSignKey,
  generateClientRsaKeyPair,
  generateNonce,
  SIGN_USER_AGENT,
  solveCapChallenge,
} from './sign.ts'

export interface WalnutEnvelope<T = Record<string, unknown>> {
  code: number
  data: T
  msg?: string
  requestId?: string
  meta?: Record<string, unknown>
}

export interface WalnutAuthTokens {
  accessToken: string
  sessionKey: string
}

interface RequestOptions {
  body?: unknown
  /** false = 不发签名头（sign-free 引导端点） */
  sign?: boolean
  headers?: Record<string, string>
}

const OPAQUE_SERVER_IDENTIFIER = 'walnut-admin'

/** device/initial 撞 42900 时最多换几个地址重放（见 bootstrap 注释；每个地址一个 /60s 桶） */
const BOOTSTRAP_REAL_IP_RETRY_LIMIT = 8

/**
 * 协议请求的业务错误（带 code，供重试 / 分支断言；`request()` 只对非 20000 抛它）。
 *
 * `meta` 一并保留：锁屏退避的 40000 用 `meta.retryAfterSec` 表达「退避期内一律拒绝」，
 * 没有它就只能看到业务码、无法断言拒绝语义（J1 的负向判据需要）。
 */
export class WalnutProtocolRequestError extends Error {
  readonly code: number
  readonly status: number
  readonly meta?: Record<string, unknown>

  constructor(method: string, path: string, status: number, code: number, msg?: string, meta?: Record<string, unknown>) {
    super(`[e2e/protocol] ${method} ${path} 失败：HTTP ${status} code=${code} msg=${msg ?? ''}`)
    this.name = 'WalnutProtocolRequestError'
    this.code = code
    this.status = status
    this.meta = meta
  }
}

/** 等 OPAQUE 的 wasm 模块就绪（Node 侧第一次调用前必须 await；否则 server.getPublicKey 之类会炸） */
async function ensureOpaqueReady(): Promise<void> {
  await opaque.ready
}

export class WalnutProtocolClient {
  private readonly cookies = new Map<string, string>()
  private readonly rsa = generateClientRsaKeyPair()
  private readonly fingerprint = randomUUID()

  private aesKey = ''
  private hkdfInfo = ''
  private auth: WalnutAuthTokens | null = null
  private _deviceId = ''

  private readonly apiBase: string
  /**
   * 本客户端所有请求携带的 `X-Forwarded-For`（= 后端的 req.realIp）。
   *
   * 为什么每个客户端一个：`device/initial` 的 throttle 是 **4 次/60s per realIp**
   * （SysDeviceSettingService），而协议客户端每次 bootstrap 都要登记一台设备；
   * 全套用例共用 127.0.0.1 会在第 5 台设备登记时 42900。给每个客户端一个 127/8 的
   * local IP，既保持「本地定位、零外网」，又各自独立计数。
   *
   * 可变：`bootstrap()` 命中 42900 时会换下一个地址重试（见该方法注释）—— R4 实测
   * Playwright 每个 spec 文件是独立 worker 进程，`uniqueLocalIp` 的模块级序号会在文件
   * 之间重置；只靠序号会从同一地址起步、多文件叠加后撞桶。`device-fixtures.ts` 用
   * pid 偏移起步，这里再做一次「换地址重放」兜底。
   */
  private realIp: string | null

  constructor(options: { apiBase?: string, realIp?: string } = {}) {
    this.apiBase = options.apiBase ?? BACKEND_API_BASE
    this.realIp = options.realIp ?? null
  }

  get deviceId(): string {
    return this._deviceId
  }

  get tokens(): WalnutAuthTokens | null {
    return this.auth
  }

  /** 读 cookie（调试 / 断言用；值里带签名前缀，原样返回） */
  getCookie(name: string): string | undefined {
    return this.cookies.get(name)
  }

  /**
   * 种/覆盖一枚 cookie（值用 Set-Cookie 里的原样形态，含 `s%3A` 编码）。
   * 续期用例用它把浏览器已持有的 DEVICE_ID 搬进协议客户端的 jar，再以真实协议触发 DeviceGuard。
   */
  setCookie(name: string, value: string): void {
    this.cookies.set(name, value)
  }

  /** 当前 Cookie 头（供 `page.context().addCookies` 之外的场景复用） */
  cookieHeader(): string {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
  }

  /**
   * 清掉客户端侧的登录态（模拟「服务端已登出 / RT 已删」后的第一次请求）。
   *
   * 为什么需要：签名模式由 `this.auth` 决定 —— 有 auth 时发**双因子**签名；而 `login/start`
   * 是 JWT-free 端点，服务端按**单因子**校验。旧 AT 留着再登录会 40112（Invalid Signature）。
   * 服务端的 RT / 会话残留由调用方用 `clearRefreshTokensForDevice` +
   * `deleteAuthSessionsForDevice` 清（与 `seedLoggedInDevice` 的「登出」口径一致）。
   */
  clearAuth(): void {
    this.auth = null
  }

  /** 裸 fetch（不带签名头）。XFF / UA 等完全由调用方决定 */
  async rawFetch(method: HttpMethod, path: string, options: { body?: unknown, headers?: Record<string, string> } = {}): Promise<Response> {
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        'user-agent': SIGN_USER_AGENT,
        ...(this.realIp === null ? {} : { 'x-forwarded-for': this.realIp }),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader() } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    this.captureCookies(response)
    return response
  }

  /**
   * 统一请求：签名头按登录状态现算；Set-Cookie 回写 jar；返回业务壳。
   *
   * 泛型默认值来自 `@walnut/api-types` 的生成物（`paths[路径][方法]` 的 200 响应 `data`）：
   * 路径是契约里的字面量常量时，响应字段改名 / 改嵌套会让 `types:check` 直接指出调用点。
   * 调用点仍可显式覆盖（`request<string>` / `request<{ ... }>`）—— 动态拼接的路径（含运行时 id）
   * 在类型层对不上生成物，本来就只能靠调用方声明。
   */
  request<P extends string, M extends HttpMethod>(
    method: M,
    path: P,
    options?: RequestOptions,
  ): Promise<WalnutEnvelope<EndpointData<P, M>>>
  request<T>(
    method: HttpMethod,
    path: string,
    options?: RequestOptions,
  ): Promise<WalnutEnvelope<T>>
  async request<T = Record<string, unknown>>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<WalnutEnvelope<T>> {
    const response = await this.signedFetch(method, path, options)
    const text = await response.text()
    let body: WalnutEnvelope<T>
    try {
      body = JSON.parse(text) as WalnutEnvelope<T>
    }
    catch {
      throw new Error(`[e2e/protocol] ${method} ${path} 返回非 JSON（HTTP ${response.status}）：${text.slice(0, 300)}`)
    }

    if (body.code !== WalnutAdminConstAppResponseCode.SUCCESS) {
      throw new WalnutProtocolRequestError(method, path, response.status, body.code, body.msg, body.meta)
    }

    return body
  }

  /**
   * FreeResponse 端点的裸请求（CAP challenge / redeem 不套统一响应壳，见
   * `@WalnutAdminDecoratorFreeResponse`）—— 仍走签名规则与 cookie jar。
   */
  async requestFree<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.signedFetch(method, path, options)
    const text = await response.text()
    try {
      return JSON.parse(text) as T
    }
    catch {
      throw new Error(`[e2e/protocol] ${method} ${path} 返回非 JSON（HTTP ${response.status}）：${text.slice(0, 300)}`)
    }
  }

  /** 真正发请求：签名头 / cookie / UA 都在这里装配 */
  private async signedFetch(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'user-agent': SIGN_USER_AGENT,
      'x-fingerprint': this.fingerprint,
      ...(this.realIp === null ? {} : { 'x-forwarded-for': this.realIp }),
      ...options.headers,
    }

    // 有 body 就必须带 content-type（express.json 只认这个头）：sign-free 的引导端点
    // （device/initial、sign/initial、cap/*）同样需要，否则 express 解析出空对象 → 40099。
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
    }

    if (options.sign !== false) {
      if (this.aesKey === '') {
        throw new Error('[e2e/protocol] 握手未完成：缺 aesKey（先调 bootstrap()）')
      }

      const timestamp = Date.now()
      const nonce = generateNonce()
      const { path: rawPath, query } = splitPathAndQuery(path)
      const raw = buildSignRaw({
        method,
        path: rawPath,
        query,
        body: options.body,
        timestamp,
        nonce,
        ua: SIGN_USER_AGENT,
      })

      headers['x-sign'] = this.auth !== null
        ? computeDualFactorSign(raw, deriveApiSignKey(this.auth.sessionKey, this.aesKey, this.hkdfInfo))
        : computeSingleFactorSign(raw, this.aesKey)
      headers['x-timestamp'] = String(timestamp)
      headers['x-nonce'] = nonce
    }

    if (this.cookies.size > 0) {
      headers.cookie = this.cookieHeader()
    }

    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    this.captureCookies(response)
    return response
  }

  /** 回写 cookie jar（服务端 cookie 全部 signed：值里带 `s%3A` 前缀，原样回传即可） */
  private captureCookies(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? ''
      const eq = pair.indexOf('=')
      if (eq > 0) {
        this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1))
      }
    }
  }

  /**
   * 便捷：已登录请求（Authorization + 双因子签名）。
   *
   * 与 {@link request} 同一套泛型规则：默认返回 200 响应壳里的 `data`（生成物推导），
   * 调用点可用显式泛型覆盖（手写形状或 `@walnut/api-types` 的别名）。
   */
  root<P extends string, M extends HttpMethod>(
    method: M,
    path: P,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<EndpointData<P, M>>
  root<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T>
  async root<T = Record<string, unknown>>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    if (this.auth === null) {
      throw new Error('[e2e/protocol] root() 需要先 login()')
    }
    const envelope = await this.request<T>(method, path, {
      body,
      headers: { Authorization: `Bearer ${this.auth.accessToken}`, ...headers },
    })
    return envelope.data
  }

  /**
   * 真实三步引导：设备登记 → CAP → 签名握手（顺序与 browser bootstrap 一致）。
   *
   * `headers` 只作用于**设备登记**那一次请求（IP 矩阵用例用它指定 XFF；CAP 与握手请求
   * 不需要重放同一个 IP，但同源的 IP 会让风控读数更干净 —— 调用方自己决定传不传）。
   */
  async bootstrap(options: { headers?: Record<string, string> } = {}): Promise<void> {
    // 1. 设备登记（sign-free / cap-free / device-free）：服务端签发 DEVICE_ID cookie
    //
    // 42900 = device/initial 的 4 次 / 60 秒 per realIp 桶命中。正常路径每个客户端一个
    // 独立地址（pid 偏移起步），这里是**兜底**：撞桶时换下一个地址立即重放，不做 sleep。
    // 其他错误（40099 / 50000 / 网络）不重试 —— 换地址也救不了。
    for (let attempt = 0; ; attempt++) {
      try {
        const device = await this.request('POST', SystemEndpointRoutes.DEVICE_INITIAL, {
          sign: false,
          headers: options.headers,
          body: { deviceInfo: {}, hardwareInfo: {}, sr: { height: 1080, width: 1920 }, vp: { height: 900, width: 1600 }, private: false },
        })
        // 字段级判据（P1-4）：生成类型已把这里的 `deviceId` 钉成 string；运行时再确认一次，
        // 缺字段 / 改名时错误消息直接说明是响应形态漂移，而不是后面某个用例拿到 undefined 才炸。
        if (typeof device.data.deviceId !== 'string' || device.data.deviceId === '') {
          throw new Error(`[e2e/protocol] device/initial 响应缺 deviceId（生成类型与运行时不一致？）：${JSON.stringify(device.data)}`)
        }
        this._deviceId = device.data.deviceId
        break
      }
      catch (error) {
        if (
          attempt < BOOTSTRAP_REAL_IP_RETRY_LIMIT
          && error instanceof WalnutProtocolRequestError
          && error.code === WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS
        ) {
          this.realIp = uniqueLocalIp()
          continue
        }
        throw error
      }
    }

    // 2. CAP：challenge → 本地 PoW 求解 → redeem（服务端种 CAPJS_TOKEN cookie）
    await this.refreshCapToken()

    // 3. 签名握手：提交客户端 RSA 公钥 → 拿被加密的 aesKey → 本地私钥解密
    await this.request('POST', SecurityRoutes.SIGN_INITIAL, {
      sign: false,
      body: { rsaPubKey: this.rsa.publicKeyPem, force: false },
    })
    const aesKeyBody = await this.request('POST', SecurityRoutes.SIGN_AES_KEY, { sign: false })
    this.aesKey = decryptAesKeyEnvelope(this.rsa.privateKeyPem, aesKeyBody.data.aesKey)
    this.hkdfInfo = aesKeyBody.data.hkdfInfo
  }

  /**
   * 重新领一枚 CAP token：challenge → 本地 PoW 求解 → redeem。
   *
   * 从 {@link bootstrap} 拆出来的原因：U13 的 40111 分支要证明「伪造凭据被拒之后，
   * 换一枚真凭据重放同一请求能成功」—— 那一步需要单独刷新 CAP 而不重走设备登记 / 握手。
   * 服务端在 redeem 里用 Set-Cookie 种新的 `CAPJS_TOKEN`（signed），本方法靠 cookie jar 自动接住。
   */
  async refreshCapToken(): Promise<void> {
    const challenge = await this.requestFree<{ challenge: { c: number, s: number, d: number }, token: string }>(
      'POST',
      SecurityRoutes.CAP_CHALLENGE,
      { sign: false },
    )
    const solutions = solveCapChallenge(challenge.challenge, challenge.token)
    const redeem = await this.requestFree<{ success?: boolean, message?: string }>('POST', SecurityRoutes.CAP_REDEEM, {
      sign: false,
      body: { token: challenge.token, solutions },
    })
    if (redeem.success !== true) {
      throw new Error(`[e2e/protocol] CAP redeem 失败：${JSON.stringify(redeem)}`)
    }
  }

  /**
   * 真实 OPAQUE 登录（与 admin 的 user-auth.ts 同一套客户端协议）：
   * login/start（单因子签名）→ 客户端 finishLogin → login/finish（仍单因子：sign guard 在
   * jwt guard 之后、passport 之前，此时 req.user 还未挂）。
   */
  async login(userName: string, password: string): Promise<WalnutAuthTokens> {
    await ensureOpaqueReady()

    const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password })
    const start = await this.request<string>('POST', AuthRoutes.OPAQUE_USER_LOGIN_START, {
      body: { userName, start: startLoginRequest },
    })

    const loginResult = opaque.client.finishLogin({
      clientLoginState,
      loginResponse: start.data,
      password,
      identifiers: { client: userName, server: OPAQUE_SERVER_IDENTIFIER },
    })

    if (!loginResult) {
      throw new Error('[e2e/protocol] opaque client finishLogin 返回 undefined（口令错 / identifiers 不一致）')
    }

    const finish = await this.request<{ accessToken: string, sessionKey: string }>(
      'POST',
      AuthRoutes.OPAQUE_USER_LOGIN_FINISH,
      { body: { userName, finish: loginResult.finishLoginRequest } },
    )

    this.auth = { accessToken: finish.data.accessToken, sessionKey: finish.data.sessionKey }
    return this.auth
  }

  /**
   * 绑定 TOTP 并完成一次设备级 MFA 验证（trusted=true ⇒ 服务端写设备级 verified 缓存）。
   *
   * 端点特性：`/system/user/mfa/totp/*` 与 `/auth/mfa/verify` 都是 MFA-free（否则未验证的
   * 用户永远绑不上）；但都需要已登录 + 双因子签名。
   *
   * 幂等：库里已有该用户的 totp 行时 generate 会 40001（DataExists）——stack.setup 会先清行。
   */
  async bindTotp(): Promise<string> {
    const { secret } = await this.bindTotpWithBackupCodes()
    return secret
  }

  /**
   * 同 {@link bindTotp}，但把 bind 响应里的**备用码**一并返回（恢复码矩阵用例需要）。
   *
   * 备用码只在 bind 响应里出现一次（服务端只存哈希后的密文，没有回读通道）——
   * 需要一次性验证的用例必须在这里接住，不能事后再取。
   */
  async bindTotpWithBackupCodes(): Promise<{ secret: string, backupCodes: string[] }> {
    const generated = await this.root<{ totpId: string, secret: string }>('POST', SystemEndpointRoutes.USER_MFA_TOTP_GENERATE)
    const code = generateSync({ secret: generated.secret })

    const bound = await this.root<{ backupCodes: string[] }>('POST', SystemEndpointRoutes.USER_MFA_TOTP_BIND, {
      name: 'e2e-totp',
      code,
      tempTotpId: generated.totpId,
    })

    if (!Array.isArray(bound.backupCodes) || bound.backupCodes.length === 0) {
      throw new Error(`[e2e/protocol] totp/bind 响应缺 backupCodes（生成类型与运行时不一致？）：${JSON.stringify(bound)}`)
    }

    const verified = await this.root<{ accessToken: string }>('POST', AuthRoutes.MFA_VERIFY, { trusted: true })
    if (this.auth !== null && verified.accessToken !== undefined) {
      // verify 轮换 AT（revoke-and-insert 的 RT 轮换由 Set-Cookie 回写 jar 负责）
      this.auth = { ...this.auth, accessToken: verified.accessToken }
    }

    return { secret: generated.secret, backupCodes: bound.backupCodes }
  }

  /**
   * 已绑定 MFA 的**新设备**登录后的第二步：用 TOTP 完成设备级验证（trusted=true ⇒ 写
   * 设备级 verified 缓存，后续请求不再被 mfa.guard 拦）。
   *
   * `options.trusted` 默认 true（既有调用方口径不变）；U14 的「未 trusted 设备」对照
   * 显式传 false —— 那正是 `sys_user_device.trusted=false` 的产生路径（admin 的 MFA 页面
   * 复选框默认也是未勾选）。
   *
   * 与 {@link bindTotp} 的 `/auth/mfa/verify` 不是同一条：那是「刚绑完、确认状态」；
   * 这条是日常登录链上的 `/system/user/mfa/totp/verify`（revoke-and-insert 轮换 RT）。
   */
  async verifyTotpForDevice(totpSecret: string, options: { trusted?: boolean } = {}): Promise<void> {
    return this.verifyMfaCode(generateSync({ secret: totpSecret }), options)
  }

  /**
   * 用**任意** MFA 码完成设备级验证：TOTP 六位码或备用码（恢复码）都走同一端点
   * （服务端先 TOTP、失败回落备用码，见 P3-23）。
   *
   * 与 {@link verifyTotpForDevice} 分开的原因：备用码不是由 secret 现算的，只能从 bind
   * 响应里拿到（一次性，见 {@link bindTotpWithBackupCodes}）。
   */
  async verifyMfaCode(code: string, options: { trusted?: boolean } = {}): Promise<void> {
    const verified = await this.root<{ accessToken: string }>('POST', SystemEndpointRoutes.USER_MFA_TOTP_VERIFY, {
      code,
      trusted: options.trusted ?? true,
    })
    if (this.auth !== null && verified.accessToken !== undefined) {
      this.auth = { ...this.auth, accessToken: verified.accessToken }
    }
  }

  /** 后端 readiness（/health/ready 是裸 Express 探针，不在 /w/v1 前缀下） */
  static async waitForHealth(timeoutMs = 60_000): Promise<void> {
    const started = Date.now()
    for (;;) {
      try {
        const response = await fetch(`${BACKEND_ORIGIN}/health/ready`)
        if (response.ok) {
          return
        }
      }
      catch {
        // 后端还没监听
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`[e2e/protocol] 后端 ${BACKEND_ORIGIN}/health/ready 在 ${timeoutMs}ms 内没有就绪`)
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}

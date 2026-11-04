import type { WalnutLockService } from '@walnut-server/lock'
import { Buffer } from 'node:buffer'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { CanActivate, ExecutionContext, Inject, Injectable, Logger, SetMetadata } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { AuthSessionService } from '@walnut-server/auth'
import { AppTechCacheRsaService, AppTechCacheSignService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { AppTechCookieService, getWalnutAdminCookie, getWalnutAdminCookieString } from '@walnut-server/cookie'
import {
  WalnutAdminExceptionExpiredSignature,
  WalnutAdminExceptionInvalidSignature,
} from '@walnut-server/exceptions/business/auth'
import { WALNUT_ADMIN_LOCK } from '@walnut-server/lock'
import { AppTokenService } from '@walnut-server/token'
import { RequestHeaders } from '@walnut/contract/http'
import { buildSignRaw, splitPathAndQuery, stripApiPrefix } from '@walnut/utils/sign-raw'
import { isNil } from 'lodash'

const WalnutAdminConstDecoratorSignFreeKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_SIGN_FREE')

export function WalnutAdminGuardSignFree() {
  return SetMetadata(WalnutAdminConstDecoratorSignFreeKey, true)
}

/**
 * 签名验证守卫（支持单因子/双因子 HMAC）
 *
 * 签名模式：
 * 1. 【未登录】单因子模式：HMAC-SHA256(raw, aesKey)
 *    - 用于注册、握手等公开接口
 *    - 仅使用设备握手时协商的 AES Key
 *
 * 2. 【已登录】双因子模式：HMAC-SHA256(raw, sessionDerivedKey)
 *    - 用于需要身份认证的接口
 *    - sessionDerivedKey = HKDF(sessionKeyHash, aesKey, info)
 *    - 结合用户会话和设备密钥，安全性更高
 *
 * 安全特性：
 * 1. RSA 证书握手（防止中间人攻击）
 * 2. 时间戳验证（防止重放攻击，5 分钟窗口）
 * 3. Nonce 去重（防止重放攻击）
 * 4. Sign Ticket 验证（额外的会话绑定）
 * 5. 多因子 HMAC 签名（METHOD + PATH + BODY + timestamp + nonce + ua）
 */
@Injectable()
export class WalnutAdminGuardSign implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardSign.name)

  // 时间戳容差（毫秒）
  private readonly TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000 // 5 分钟

  // Nonce 格式正则（32 位十六进制）
  private readonly NONCE_REGEX = /^[0-9a-f]{32}$/i

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheSignService: AppTechCacheSignService,
    private readonly cookieService: AppTechCookieService,
    private readonly cacheRsaService: AppTechCacheRsaService,
    private readonly authSessionService: AuthSessionService,
    private readonly configService: ConfigService,
    @Inject(WALNUT_ADMIN_LOCK) private readonly lockService: WalnutLockService,
    private readonly tokenService: AppTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // return true
    // 1. 检查是否标记为签名豁免
    const signFree = this.reflector.getAllAndOverride<boolean>(
      WalnutAdminConstDecoratorSignFreeKey,
      [context.getHandler(), context.getClass()],
    )

    if (signFree) {
      this.logger.debug('Sign guard: endpoint is sign-free')
      return true
    }

    const req = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()

    // 2. Postman 调试豁免（生产环境应移除）
    // F-44：这是噪声过滤，**不是安全边界** —— isPostman 已被 isDev 门住（生产恒 false），
    // 权威说明见 apps/api/src/middleware/src/user-agent.middleware.ts 的 isPostmanRuntimeRequest。
    if (req.isPostman) {
      this.logger.warn('Sign guard: bypassed for Postman request')
      return true
    }

    // 3. 提取并验证必需的 Request 头（Cookie）
    const {
      sign,
      ua,
      nonce,
      timestamp,
      deviceId,
      signTicket,
    } = this.extractRequestMetadata(req)

    // 4. 验证 RSA 证书（确保已完成握手）
    await this.cacheRsaService.getRsaPubKeyCache(deviceId)

    // 5. 验证时间戳（防止重放攻击）
    this.validateTimestamp(timestamp)

    // 6. 验证并记录 Nonce（防止重复 Request）
    await this.validateAndRecordNonce(nonce)

    // 7. 验证 Sign Ticket（会话绑定）
    await this.validateSignTicket(deviceId, signTicket, req)

    // 8. 获取 AES Key（客户端握手时协商的密钥）
    const aesKey = await this.getAesKey(deviceId)

    // 9. 从Request中获取用户会话
    const userSession = req.user

    // 10. 生成签名原文（与客户端同一纯函数：`@walnut/utils/sign-raw`）
    const APIPrefix = this.configService.get<string>('app.api.prefix')!
    const APIVersion = this.configService.get<string>('app.api.version')!
    const { path, query } = splitPathAndQuery(stripApiPrefix(req.url, APIPrefix, APIVersion))
    const raw = buildSignRaw({
      method: req.method,
      path,
      query,
      body: req.body,
      timestamp: Number(timestamp),
      nonce,
      ua,
    })

    this.logger.debug(`Sign guard: raw => ${raw}`)

    // 11. 根据是否登录选择签名模式
    let serverSign: string
    let signMode: 'single-factor' | 'dual-factor'

    if (userSession) {
      // 【已登录】双因子模式：使用 Session Key 派生密钥
      serverSign = await this.computeDualFactorSignature(
        raw,
        userSession.userId,
        deviceId,
        userSession.sid!,
        aesKey,
      )
      signMode = 'dual-factor'
      this.logger.debug(`Sign guard: using dual-factor mode (user=${userSession.userId}, session=${userSession.sid})`)
    }
    else {
      // 【未登录】单因子模式：仅使用 AES Key
      serverSign = this.computeSingleFactorSignature(raw, aesKey)
      signMode = 'single-factor'
      this.logger.debug(`Sign guard: using single-factor mode (device=${deviceId})`)
    }

    // 12. 安全比对签名（防止时序攻击）
    if (!this.timingSafeCompare(sign, serverSign)) {
      // F-06：原文（server 签名 + 完整 raw body）不入日志 —— raw 里是请求体（登录密码、
      // 验证码、PII），签名本身泄漏则 attacker 可直接重放。改打摘要：同一 raw 在两侧算出的
      // 摘要一致即可判定「原文一致但密钥不同」，排障信息不丢。
      this.logger.error(
        `Sign guard: signature mismatch (${signMode})\n`
        + `  Client digest: ${this.secretDigest(sign)}\n`
        + `  Server digest: ${this.secretDigest(serverSign)}\n`
        + `  Raw length: ${raw.length}, raw digest: ${this.secretDigest(raw)}`,
      )
      throw new WalnutAdminExceptionInvalidSignature()
    }

    this.logger.debug(`Sign guard: signature verified (${signMode})`)

    return true
  }

  /**
   * 提取 Request 元数据
   */
  private extractRequestMetadata(req: IWalnutAdminExpressRequest) {
    const sign = req.headers[RequestHeaders.SIGN.toLowerCase()] as string
    const ua = req.headers[RequestHeaders.USER_AGENT.toLowerCase()] as string
    const nonce = req.headers[RequestHeaders.NONCE.toLowerCase()] as string
    const timestamp = req.headers[RequestHeaders.TIMESTAMP.toLowerCase()] as string
    const deviceId = getWalnutAdminCookie(req, WalnutAdminConstCookieKeys.DEVICE_ID)
    // SIGN_TICKET 用 String 版本（与 device.guard.ts 的 DEVICE_ID 同口径）：cookie-parser 对
    // 「带 s: 前缀但签名不对」—— 即 APP_COOKIE_SECRET 轮换后的旧 cookie —— 返回 `false` 而不是
    // undefined，`isNil(false)` 是 false ⇒ 裸取值会让它进「与缓存不符」分支：本意抛 40112，
    // 实测连那一步都到不了 —— 该分支的日志摘要先炸（`secretDigest(false)` 的 `update(false)`
    // 触发 ERR_INVALID_ARG_TYPE ⇒ 50000，与 CAP guard 当年同形）。两种都**没有自愈路径**：缓存里
    // 那枚 ticket 还在 ⇒ 重签腿永远走不到 ⇒ 只能人工清 cookie。
    // 归一成「缺失」之后走重签：服务端用缓存值重发一枚能验签的 cookie。
    // 签名**合法**但与缓存不符仍是 40112 —— 那条语义不变（同块的正对照守着它）。
    const signTicket = getWalnutAdminCookieString(req, WalnutAdminConstCookieKeys.SIGN_TICKET)

    if (!sign || !ua || !nonce || !timestamp || !deviceId) {
      this.logger.error(
        `Sign guard: missing required metadata\n`
        + `  sign: ${!!sign}\n`
        + `  ua: ${!!ua}\n`
        + `  nonce: ${!!nonce}\n`
        + `  timestamp: ${!!timestamp}\n`
        + `  deviceId: ${!!deviceId}`,
      )
      throw new WalnutAdminExceptionInvalidSignature()
    }

    return { sign, ua, nonce, timestamp, deviceId, signTicket }
  }

  /**
   * 验证时间戳
   */
  private validateTimestamp(timestamp: string) {
    const ts = Number(timestamp)
    if (!Number.isFinite(ts)) {
      this.logger.error(`Sign guard: invalid timestamp format: ${timestamp}`)
      throw new WalnutAdminExceptionInvalidSignature()
    }

    const now = Date.now()
    const diff = Math.abs(now - ts)

    if (diff > this.TIMESTAMP_TOLERANCE_MS) {
      this.logger.error(
        `Sign guard: timestamp expired\n`
        + `  Server: ${now}\n`
        + `  Client: ${ts}\n`
        + `  Diff: ${diff}ms (max: ${this.TIMESTAMP_TOLERANCE_MS}ms)`,
      )
      throw new WalnutAdminExceptionInvalidSignature()
    }
  }

  /**
   * 验证并记录 Nonce（P2-11，2026-10-29：SET NX EX 原子判重）
   */
  private async validateAndRecordNonce(nonce: string) {
    // 验证格式
    if (!this.NONCE_REGEX.test(nonce)) {
      this.logger.error(`Sign guard: invalid nonce format: ${nonce}`)
      throw new WalnutAdminExceptionInvalidSignature()
    }

    // 原子写入：写入失败 = 该 nonce 已被消费（含并发同 nonce 的后到者）
    const recorded = await this.cacheSignService.setNonceCache(nonce)

    if (!recorded) {
      this.logger.error(`Sign guard: duplicate nonce detected: ${nonce}`)
      throw new WalnutAdminExceptionInvalidSignature()
    }
  }

  /**
   * 验证 Sign Ticket
   */
  private async validateSignTicket(deviceId: string, signTicket: string | undefined, req: IWalnutAdminExpressRequest) {
    const cachedSignTicket = await this.cacheSignService.getSignTicketCache(deviceId)

    // 缓存存在 - 快速路径(无锁)
    if (!isNil(cachedSignTicket)) {
      if (!isNil(signTicket) && signTicket !== cachedSignTicket) {
        // F-06：signTicket 是会话绑定的凭据（Cookie 值，可被直接回放），error 级日志会落盘
        // —— 同样只打摘要。
        this.logger.error(
          `Sign guard: sign ticket mismatch\n`
          + `  Cookie digest: ${this.secretDigest(signTicket)}\n`
          + `  Cache digest: ${this.secretDigest(cachedSignTicket)}`,
        )
        throw new WalnutAdminExceptionInvalidSignature()
      }

      // 续签
      await this.cacheSignService.setSignTicketCache(deviceId, cachedSignTicket)
      this.setSignTicketCookie(req, cachedSignTicket)
      return
    }

    // 缓存不存在 - 加锁路径
    await this.generateSignTicketWithLock(deviceId, req)
  }

  /**
   * 使用分布式锁生成 Sign Ticket
   */
  private async generateSignTicketWithLock(
    deviceId: string,
    req: IWalnutAdminExpressRequest,
  ) {
    const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:SIGN:${deviceId}`

    await this.lockService.runWithLock(
      lockKey,
      3000,
      async () => {
      // 双重检查
        const doubleCheckTicket = await this.cacheSignService.getSignTicketCache(deviceId)

        if (!isNil(doubleCheckTicket)) {
          this.logger.log(`Sign ticket double cache hit: ${deviceId}`)
          this.setSignTicketCookie(req, doubleCheckTicket)
          return
        }

        // 生成新 ticket
        this.logger.log(`Generating new sign ticket: ${deviceId}`)
        const newTicket = randomBytes(16).toString('base64url')

        await this.cacheSignService.setSignTicketCache(deviceId, newTicket)
        this.setSignTicketCookie(req, newTicket)

        this.logger.log(`Sign ticket created: ${deviceId}`)
      },
    )
  }

  /**
   * 设置 Sign Ticket Cookie
   */
  private setSignTicketCookie(req: IWalnutAdminExpressRequest, ticket: string) {
    this.cookieService.setResponseCookie(req, [{ key: WalnutAdminConstCookieKeys.SIGN_TICKET, value: ticket, options: { maxAge: this.tokenService.getAccessTokenExpireSeconds() * 1000 } }])
  }

  /**
   * 获取 AES Key
   */
  private async getAesKey(deviceId: string): Promise<string> {
    const aesKey = await this.cacheSignService.getAesKeyCache(deviceId)

    if (isNil(aesKey)) {
      this.logger.error(`Sign guard: AES key not found for device=${deviceId}`)
      throw new WalnutAdminExceptionExpiredSignature()
    }

    // F-06：aesKey 是握手协商的会话密钥（HMAC 的 key），任何长度前缀都不该入日志；
    // 打长度即可区分「拿到了空值 / 拿到了完整密钥」。
    this.logger.debug(`Sign guard: aesKey length => ${aesKey.length}`)
    return aesKey
  }

  /**
   * 计算单因子签名（未登录模式）
   *
   * 公式：HMAC-SHA256(raw, aesKey)
   *
   * @param raw 签名原文
   * @param aesKey 设备握手时协商的 AES 密钥
   * @returns 签名（hex 编码）
   */
  private computeSingleFactorSignature(raw: string, aesKey: string): string {
    return createHmac('sha256', aesKey)
      .update(raw, 'utf8')
      .digest('hex')
  }

  /**
   * 计算双因子签名（已登录模式）
   *
   * 公式：HMAC-SHA256(raw, sessionDerivedKey)
   * 其中：sessionDerivedKey = HKDF(sessionKeyHash, aesKey, info)
   *
   * 双因子优势：
   * 1. 结合用户会话（session key）和设备密钥（aes key）
   * 2. 即使 AES Key 泄露，攻击者也无法伪造其他用户的签名
   * 3. 支持按用户粒度吊销签名能力
   *
   * @param raw 签名原文
   * @param userId User ID
   * @param deviceId Device ID
   * @param sessionId 会话 ID
   * @param aesKey 设备握手时协商的 AES 密钥
   * @returns 签名（hex 编码）
   */
  private async computeDualFactorSignature(
    raw: string,
    userId: string,
    deviceId: string,
    sessionId: string,
    aesKey: string,
  ): Promise<string> {
    // 1. 派生基于 Session Key 的签名密钥
    const derivedSignKey = await this.authSessionService.deriveApiSignKey(
      userId,
      deviceId,
      sessionId,
      aesKey,
    )

    if (!derivedSignKey) {
      // P0-2 修复（2026-10-28）：req.user 存在时双因子派生失败**直接拒绝**，不再降级单因子。
      // 降级曾让「正确签名的伪造 AT + 设备 aesKey + 显式单因子签名」绕过会话绑定
      // （会话吊销对自选签名模式的客户端不设防）；未登录请求仍走单因子（登录/握手端点）。
      this.logger.error(
        `Sign guard: session not found for authenticated request, rejecting `
        + `(user=${userId}, device=${deviceId}, session=${sessionId})`,
      )
      throw new WalnutAdminExceptionInvalidSignature()
    }

    // 2. 使用派生密钥计算 HMAC
    return createHmac('sha256', Buffer.from(new Uint8Array(derivedSignKey)))
      .update(raw, 'utf8')
      .digest('hex')
  }

  /**
   * 日志用摘要（sha256 前 8 个十六进制字符）
   *
   * F-06：签名 / 签名原文（含请求体）不得入日志。摘要足以支撑排障判断
   * （「两侧算的是不是同一份原文」「客户端送来的签名有没有变」），但无法反推原文或密钥。
   */
  private secretDigest(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8)
  }

  /**
   * 安全比对签名（防止时序攻击）
   */
  private timingSafeCompare(clientSign: string, serverSign: string): boolean {
    if (clientSign.length !== serverSign.length) {
      return false
    }

    try {
      return timingSafeEqual(
        Buffer.from(clientSign, 'hex'),
        Buffer.from(serverSign, 'hex'),
      )
    }
    catch {
      return false
    }
  }
}

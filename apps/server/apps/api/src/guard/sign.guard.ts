import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { CanActivate, ExecutionContext, Injectable, Logger, SetMetadata } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { RequestHeaders } from '@walnut/contract/http'
import {
  WalnutAdminExceptionExpiredSignature,
  WalnutAdminExceptionInvalidSignature,
} from '@walnut-server/exceptions/business/auth'
import { objectToPaths } from '@walnut-server/utils/general'
import { isNil } from 'lodash'
import { MurLockService } from 'murlock'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { AuthSessionService } from '@/modules/auth/modules/session/session.service'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { AppTechCacheRsaService } from '@/modules/techniques/cache/service/cache.rsa'
import { AppTechCacheSignService } from '@/modules/techniques/cache/service/cache.sign'
import { AppTechCookieService } from '@/modules/techniques/cookie/cookie.service'

const WalnutAdminConstDecoratorSignFreeKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_SIGN_FREE')

export function WalnutAdminGuardSignFree() {
  return SetMetadata(WalnutAdminConstDecoratorSignFreeKey, true)
}

/**
 * 构建签名原文
 * 格式: METHOD|PATH|BODY_PARAMS|timestamp=xxx|nonce=xxx|ua=xxx
 */
function buildSignRaw(
  req: IWalnutAdminExpressRequest,
  APIPrefix: string,
  APIVersion: string,
  timestamp: number,
  nonce: string,
  ua: string,
): string {
  // 1. 扁平化Request体并排�?
  const flattenObj = objectToPaths(req.body ?? {})
  const sortedParams = Object.keys(flattenObj)
    .sort()
    .map(k => `${k}=${flattenObj[k]}`)
    .join('&')

  // 2. 规范化路由路径（去除 API 前缀和版本）
  const routePath = req.url.replace(new RegExp(`^/${APIPrefix}/v${APIVersion}`), '') || '/'

  // 3. 组装签名原文（多因子�?
  return [
    req.method.toUpperCase(), // HTTP 方法
    routePath, // 路由路径
    sortedParams, // 请求参数（排序）
    `timestamp=${timestamp}`, // 时间?
    `nonce=${nonce}`, // 随机?
    `ua=${ua}`, // User-Agent
  ].join('|')
}

/**
 * 签名验证守卫（支持单因子/双因�?HMAC�?
 *
 * 签名模式�?
 * 1. 【未登录】单因子模式：HMAC-SHA256(raw, aesKey)
 *    - 用于注册、握手等公开接口
 *    - 仅使用设备握手时协商�?AES Key
 *
 * 2. 【已登录】双因子模式：HMAC-SHA256(raw, sessionDerivedKey)
 *    - 用于需要身份认证的接口
 *    - sessionDerivedKey = HKDF(sessionKeyHash, aesKey, info)
 *    - 结合用户会话和设备密钥，安全性更�?
 *
 * 安全特性：
 * 1. RSA 证书握手（防止中间人攻击�?
 * 2. 时间戳验证（防止重放攻击�? 分钟窗口�?
 * 3. Nonce 去重（防止重放攻击）
 * 4. Sign Ticket 验证（额外的会话绑定�?
 * 5. 多因�?HMAC 签名（METHOD + PATH + BODY + timestamp + nonce + ua�?
 */
@Injectable()
export class WalnutAdminGuardSign implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardSign.name)

  // 时间戳容差（毫秒�?
  private readonly TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000 // 5 分钟

  // Nonce 格式正则�?2 位十六进制）
  private readonly NONCE_REGEX = /^[0-9a-f]{32}$/i

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheSignService: AppTechCacheSignService,
    private readonly cookieService: AppTechCookieService,
    private readonly cacheRsaService: AppTechCacheRsaService,
    private readonly authSessionService: AuthSessionService,
    private readonly configService: ConfigService,
    private readonly murLockService: MurLockService,
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

    // 2. Postman 调试豁免（生产环境应移除�?
    if (req.isPostman) {
      this.logger.warn('Sign guard: bypassed for Postman request')
      return true
    }

    // 3. 提取并验证必需的Request头�?Cookie
    const {
      sign,
      ua,
      nonce,
      timestamp,
      deviceId,
      signTicket,
    } = this.extractRequestMetadata(req)

    // 4. 验证 RSA 证书（确保已完成握手�?
    await this.cacheRsaService.getRsaPubKeyCache(deviceId)

    // 5. 验证时间戳（防止重放攻击�?
    this.validateTimestamp(timestamp)

    // 6. 验证并记�?Nonce（防止重复Request）
    await this.validateAndRecordNonce(nonce)

    // 7. 验证 Sign Ticket（会话绑定）
    await this.validateSignTicket(deviceId, signTicket, req)

    // 8. 获取 AES Key（客户端握手时协商的密钥�?
    const aesKey = await this.getAesKey(deviceId)

    // 9. 从Request中获取用户会话
    const userSession = req.user

    // 10. 生成签名原文
    const APIPrefix = this.configService.get<string>('app.api.prefix')!
    const APIVersion = this.configService.get<string>('app.api.version')!
    const raw = buildSignRaw(req, APIPrefix, APIVersion, Number(timestamp), nonce, ua)

    this.logger.debug(`Sign guard: raw => ${raw}`)

    // 11. 根据是否登录选择签名模式
    let serverSign: string
    let signMode: 'single-factor' | 'dual-factor'

    if (userSession) {
      // 【已登录】双因子模式：使�?Session Key 派生密钥
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
      this.logger.error(
        `Sign guard: signature mismatch (${signMode})\n`
        + `  Client: ${sign}\n`
        + `  Server: ${serverSign}\n`
        + `  Raw: ${raw}`,
      )
      throw new WalnutAdminExceptionInvalidSignature()
    }

    this.logger.debug(`Sign guard: signature verified (${signMode})`)

    return true
  }

  /**
   * 提取Request元数�?
   */
  private extractRequestMetadata(req: IWalnutAdminExpressRequest) {
    const sign = req.headers[RequestHeaders.SIGN.toLowerCase()] as string
    const ua = req.headers[RequestHeaders.USER_AGENT.toLowerCase()] as string
    const nonce = req.headers[RequestHeaders.NONCE.toLowerCase()] as string
    const timestamp = req.headers[RequestHeaders.TIMESTAMP.toLowerCase()] as string
    const deviceId = getWalnutAdminCookie(req, WalnutAdminConstCookieKeys.DEVICE_ID)
    const signTicket = getWalnutAdminCookie(req, WalnutAdminConstCookieKeys.SIGN_TICKET)

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
   * 验证时间�?
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
   * 验证并记�?Nonce
   */
  private async validateAndRecordNonce(nonce: string) {
    // 验证格式
    if (!this.NONCE_REGEX.test(nonce)) {
      this.logger.error(`Sign guard: invalid nonce format: ${nonce}`)
      throw new WalnutAdminExceptionInvalidSignature()
    }

    // 检查是否已使用
    const nonceCache = await this.cacheSignService.getNonceCache(nonce)
    if (!isNil(nonceCache)) {
      this.logger.error(`Sign guard: duplicate nonce detected: ${nonce}`)
      throw new WalnutAdminExceptionInvalidSignature()
    }

    // 记录 Nonce（建议使�?Redis NX 操作保证原子性）
    await this.cacheSignService.setNonceCache(nonce)
  }

  /**
   * 验证 Sign Ticket
   */
  private async validateSignTicket(deviceId: string, signTicket: string | null, req: IWalnutAdminExpressRequest) {
    const cachedSignTicket = await this.cacheSignService.getSignTicketCache(deviceId)

    // 缓存存在 - 快速路�?无锁)
    if (!isNil(cachedSignTicket)) {
      if (!isNil(signTicket) && signTicket !== cachedSignTicket) {
        this.logger.error(
          `Sign guard: sign ticket mismatch\n`
          + `  Cookie: ${signTicket}\n`
          + `  Cache: ${cachedSignTicket}`,
        )
        throw new WalnutAdminExceptionInvalidSignature()
      }

      // 续签
      await this.cacheSignService.setSignTicketCache(deviceId, cachedSignTicket)
      this.setSignTicketCookie(req, cachedSignTicket)
      return
    }

    // 缓存不存�?- 加锁路径
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

    await this.murLockService.runWithLock(
      lockKey,
      3000,
      async () => {
      // 双重检�?
        const doubleCheckTicket = await this.cacheSignService.getSignTicketCache(deviceId)

        if (!isNil(doubleCheckTicket)) {
          this.logger.log(`Sign ticket double cache hit: ${deviceId}`)
          this.setSignTicketCookie(req, doubleCheckTicket)
          return
        }

        // 生成�?ticket
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

    this.logger.debug(`Sign guard: aesKey => ${aesKey.substring(0, 8)}...`)
    return aesKey
  }

  /**
   * 计算单因子签名（未登录模式）
   *
   * 公式：HMAC-SHA256(raw, aesKey)
   *
   * @param raw 签名原文
   * @param aesKey 设备握手时协商的 AES 密钥
   * @returns 签名（hex 编码�?
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
   * 1. 结合用户会话（session key）和设备密钥（aes key�?
   * 2. 即使 AES Key 泄露，攻击者也无法伪造其他用户的签名
   * 3. 支持按用户粒度吊销签名能力
   *
   * @param raw 签名原文
   * @param userId User ID
   * @param deviceId Device ID
   * @param sessionId 会话 ID
   * @param aesKey 设备握手时协商的 AES 密钥
   * @returns 签名（hex 编码�?
   */
  private async computeDualFactorSignature(
    raw: string,
    userId: string,
    deviceId: string,
    sessionId: string,
    aesKey: string,
  ): Promise<string> {
    // 1. 派生基于 Session Key 的签名密�?
    const derivedSignKey = await this.authSessionService.deriveApiSignKey(
      userId,
      deviceId,
      sessionId,
      aesKey,
    )

    if (!derivedSignKey) {
      // Session 已过期或被吊销，降级为单因子模�?
      this.logger.warn(
        `Sign guard: session not found, fallback to single-factor mode `
        + `(user=${userId}, device=${deviceId}, session=${sessionId})`,
      )
      return this.computeSingleFactorSignature(raw, aesKey)
    }

    // 2. 使用派生密钥计算 HMAC
    return createHmac('sha256', Buffer.from(new Uint8Array(derivedSignKey)))
      .update(raw, 'utf8')
      .digest('hex')
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

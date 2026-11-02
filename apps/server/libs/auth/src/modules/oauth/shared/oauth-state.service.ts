import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { LocaleType } from '@walnut/contract'

/**
 * OAuth `state` 的签发与一次性校验（P2-13，2026-10-28）。
 *
 * 修复前的 state 是 `JSON.stringify({ fp, lang })` 原文：无签名（可伪造任意 fp 频道）、
 * 无一次性（可重放）、不绑定发起设备 —— 攻击者取自己的授权 URL 诱导受害者完成 IdP
 * 登录，令牌经 SSE 投递到攻击者订阅的频道（登录 CSRF）。
 *
 * 现在的形态：`base64url(JSON{fp,lang,nonce}) . base64url(HMAC-SHA256(payload))`。
 * - 签名密钥复用服务端既有密钥通道 `app.session.secret`（与 express-session 同源，
 *   部署形态已存在该 secret，无需新增 env）；
 * - nonce 与**发起请求的 deviceId** 一并落 Redis（`AUTH:OAUTH_STATE:<nonce>`，10 分钟
 *   TTL）；callback 校验时要求 cookie 里的 deviceId 与签发时一致 —— 跨设备完成授权
 *   直接拒绝（CSRF 的真正堵法：签名只能防篡改，设备绑定才防「别人的 state」）；
 * - 校验走 Redis DEL 计数（返回 1 才有效），天然一次性（并发下也只有一个赢家）。
 *
 * 失败由调用方（OAuth guard）转成既有受控错误壳（40000），不改 302 / Render 流程。
 */
export interface IWalnutOAuthStatePayload {
  fp: string
  lang?: LocaleType
  nonce: string
}

const OAUTH_STATE_TTL_SECONDS = 10 * 60

@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: AppTechCacheService,
  ) {}

  private get signingKey(): string {
    return this.configService.get<string>('app.session.secret')!
  }

  private getNonceCacheKey(nonce: string): string {
    return `${WalnutAdminConstAppCacheKeys.AUTH_OAUTH_STATE}:${nonce}`
  }

  private sign(encodedPayload: string): string {
    return createHmac('sha256', this.signingKey)
      .update(encodedPayload, 'utf8')
      .digest('base64url')
  }

  private static safeEqual(left: string, right: string): boolean {
    const leftBuf = Buffer.from(left, 'utf8')
    const rightBuf = Buffer.from(right, 'utf8')

    if (leftBuf.length !== rightBuf.length) {
      return false
    }

    return timingSafeEqual(leftBuf, rightBuf)
  }

  /**
   * @description 签发 state（签名 + 落一次性 nonce；绑定发起请求的 deviceId）
   *
   * F5：fp / deviceId 必须是非空字符串 —— 空值不签发（否则会出现
   * `undefined === undefined` 的伪绑定，跨设备校验失效）。受控 40000 由全局过滤器输出。
   */
  async issueState(fingerprint: string, lang: LocaleType, deviceId: string): Promise<string> {
    if (typeof fingerprint !== 'string' || fingerprint.length === 0
      || typeof deviceId !== 'string' || deviceId.length === 0) {
      throw new WalnutAdminExceptionBadRequest({
        _devMsg: 'oauth state requires non-empty fingerprint and deviceId',
      })
    }

    const nonce = randomBytes(16).toString('hex')

    await this.cacheService.set(
      this.getNonceCacheKey(nonce),
      { fp: fingerprint, deviceId },
      { t: WalnutAdminConstAppCacheType.AUTH, ttl: OAUTH_STATE_TTL_SECONDS },
    )

    const payload: IWalnutOAuthStatePayload = { fp: fingerprint, lang, nonce }
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')

    return `${encodedPayload}.${this.sign(encodedPayload)}`
  }

  /**
   * @description 校验并消费 state；返回解析后的 payload（含 fp / lang），失败返回 null。
   * 校验顺序：形态 → 签名（时序安全比较）→ payload 解析 → Redis 存在性 + 设备绑定 →
   * DEL 计数（=1 才视为消费成功，并发重放只有一个赢家）。
   */
  async consumeState(state: string | undefined, deviceId: string): Promise<IWalnutOAuthStatePayload | null> {
    if (typeof state !== 'string' || state.length === 0) {
      return null
    }

    // F5：deviceId 必须是显式非空串 —— 不允许 null/undefined 与存储值的空值「相等」
    if (typeof deviceId !== 'string' || deviceId.length === 0) {
      this.logger.warn('oauth state rejected: missing deviceId')
      return null
    }

    const parts = state.split('.')
    if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
      this.logger.warn('oauth state rejected: malformed')
      return null
    }

    const [encodedPayload, signature] = parts
    const expectedSignature = this.sign(encodedPayload)

    if (!OAuthStateService.safeEqual(signature, expectedSignature)) {
      this.logger.warn('oauth state rejected: signature mismatch')
      return null
    }

    let payload: IWalnutOAuthStatePayload
    try {
      const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<IWalnutOAuthStatePayload>
      if (typeof parsed.fp !== 'string' || parsed.fp.length === 0 || typeof parsed.nonce !== 'string' || parsed.nonce.length === 0) {
        this.logger.warn('oauth state rejected: payload shape invalid')
        return null
      }
      payload = parsed as IWalnutOAuthStatePayload
    }
    catch {
      this.logger.warn('oauth state rejected: payload not JSON')
      return null
    }

    const nonceCacheKey = this.getNonceCacheKey(payload.nonce)
    const stored = await this.cacheService.get<{ fp: string, deviceId: string }>(nonceCacheKey)

    if (stored === null || stored.fp !== payload.fp || stored.deviceId !== deviceId) {
      this.logger.warn(`oauth state rejected: nonce missing or device mismatch (nonce=${payload.nonce})`)
      return null
    }

    // 一次性消费：DEL 计数 = 1 才是本次请求拿到的 nonce（并发重放只有一个赢家）
    const deleted = await this.cacheService.delAndCount(nonceCacheKey)
    if (deleted !== 1) {
      this.logger.warn(`oauth state rejected: nonce already consumed (nonce=${payload.nonce})`)
      return null
    }

    return payload
  }
}

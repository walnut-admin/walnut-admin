import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { AppTechCacheService } from '../cache.service'

@Injectable()
export class AppTechCacheSignService {
  private readonly logger = new Logger(AppTechCacheSignService.name)

  constructor(private readonly cacheService: AppTechCacheService, private readonly tokenService: AppTokenService) {}

  async setSignTicketCache(deviceId: string, payload: string) {
    this.logger.debug(`set sign ticket cache, deviceId: ${deviceId}, payload: ${payload}`)
    await this.cacheService.set(`${WalnutAdminConstAppCacheKeys.SECURITY_SIGN_TICKET}:${deviceId}`, payload, { t: WalnutAdminConstAppCacheType.AUTH, ttl: this.tokenService.getAccessTokenExpireSeconds() })
  }

  async getSignTicketCache(deviceId: string) {
    this.logger.debug(`get sign ticket cache, deviceId: ${deviceId}`)
    return this.cacheService.get<string>(`${WalnutAdminConstAppCacheKeys.SECURITY_SIGN_TICKET}:${deviceId}`)
  }

  async setAesKeyCache(deviceId: string, payload: string) {
    this.logger.debug(`set aes key cache, deviceId: ${deviceId}, payload: ${payload}`)
    await this.cacheService.set(`${WalnutAdminConstAppCacheKeys.SECURITY_SIGN_AES_KEY}:${deviceId}`, payload, { t: WalnutAdminConstAppCacheType.AUTH, ttl: this.tokenService.getAccessTokenExpireSeconds() })
  }

  async getAesKeyCache(deviceId: string) {
    this.logger.debug(`get aes key cache, deviceId: ${deviceId}`)
    return this.cacheService.get<string>(`${WalnutAdminConstAppCacheKeys.SECURITY_SIGN_AES_KEY}:${deviceId}`)
  }

  /**
   * P2-11（2026-10-29）：nonce 一次性记录改为原子 `SET NX EX` —— 返回 false 即该 nonce
   * 已被使用（并发同 nonce 只有一路能写入）。TTL 仍是 5 分钟（与签名时间窗同量级）。
   */
  async setNonceCache(nonce: string): Promise<boolean> {
    this.logger.debug(`set nonce cache, nonce: ${nonce}`)
    return this.cacheService.setIfAbsent(
      `${WalnutAdminConstAppCacheKeys.SECURITY_SIGN_NONCE}:${nonce}`,
      1,
      { t: WalnutAdminConstAppCacheType.AUTH, ttl: 5 * 60 },
    )
  }

  async getNonceCache(nonce: string) {
    this.logger.debug(`get nonce cache, nonce: ${nonce}`)
    return this.cacheService.get<string>(`${WalnutAdminConstAppCacheKeys.SECURITY_SIGN_NONCE}:${nonce}`)
  }
}

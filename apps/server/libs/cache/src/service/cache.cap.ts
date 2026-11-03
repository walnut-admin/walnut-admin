import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { resolveCapCacheTtlSeconds } from '@walnut-server/const/app/cap'
import { AppTechCacheService } from '../cache.service'
import { AppTechCacheAppSettingsService } from './cache.appSettings'

/**
 * P0-3 修复（2026-10-28）：
 * - 缓存键掺 token 指纹（sha256 前 16 hex）—— 校验结果与「哪一枚 CAP token」绑定，
 *   跨设备移植另一台设备的签名 cookie 不再命中本设备的缓存快照。
 *
 * P1 修复（review CAP-1 / CAP-2）：
 * - TTL 单位钉成**秒**：`getCapJSConfig().ttl` 的权威单位是秒，缓存 `set` 也收秒，
 *   换算只走 `resolveCapCacheTtlSeconds`（同源 @walnut-server/const/app/cap）；
 *   旧的 `Math.ceil(config.ttl / 1000)` 把 ttl 当毫秒 ⇒ 种子值 3600 下缓存只有 **4 秒**。
 * - 窗口 = **min(ttl, 20min)**：cap.js 的 token 寿命硬编码 20 分钟，缓存不得长于它，
 *   否则缓存命中等于放行一枚 cap.js 已经不认的凭据。
 */
@Injectable()
export class AppTechCacheCapService {
  private readonly logger = new Logger(AppTechCacheCapService.name)

  constructor(
    private readonly cacheService: AppTechCacheService,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
  ) { }

  private readonly getCapTokenCacheKey = (deviceId: string, tokenFingerprint: string) => `${WalnutAdminConstAppCacheKeys.SECURITY_CAP_TOKEN}:${deviceId}:${tokenFingerprint}`

  /**
   * @description token 指纹（值绑定设备）：完整 token 不进 Redis 键，取 sha256 前 16 hex
   */
  private getTokenFingerprint(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16)
  }

  /**
   * @description set CAP server state cache（键 = deviceId + token 指纹）
   */
  async setCapTokenCache(deviceId: string, token: string) {
    const cacheKey = this.getCapTokenCacheKey(deviceId, this.getTokenFingerprint(token))
    const config = await this.cacheAppSettingsService.getCapJSConfig()
    // config.ttl 单位是秒；窗口 = min(ttl, cap.js token 寿命 20min)，
    // 且下限 1 秒（Redis set 的 ttl<=0 是「永不过期」）—— 三条都在 resolveCapCacheTtlSeconds 里
    const ttl = resolveCapCacheTtlSeconds(config.ttl)
    await this.cacheService.set(cacheKey, true, {
      t: WalnutAdminConstAppCacheType.AUTH,
      ttl,
    })
    this.logger.debug(`Set CAP token cache: key => ${cacheKey}, ttl => ${ttl}s`)
  }

  /**
   * @description delete CAP token cache（该设备的所有 token 指纹）
   */
  async delCapTokenCache(deviceId: string) {
    const pattern = `${this.getCapTokenCacheKey(deviceId, '*')}`
    const deletedKeys = await this.cacheService.delByPattern(pattern)
    this.logger.debug(`Delete CAP token cache: pattern => ${pattern}, deleted => ${deletedKeys.length}`)
    return deletedKeys
  }

  /**
   * @description get CAP token cache（按设备 + token 指纹查）
   */
  async getCapTokenCache(deviceId: string, token: string) {
    const cacheKey = this.getCapTokenCacheKey(deviceId, this.getTokenFingerprint(token))
    this.logger.debug(`Get CAP token cache: key => ${cacheKey}`)
    return this.cacheService.get<boolean>(cacheKey)
  }
}

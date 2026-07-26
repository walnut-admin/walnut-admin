import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut/const/app/cache'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'

@Injectable()
export class AppTechCacheOpaqueService {
  private readonly logger = new Logger(AppTechCacheOpaqueService.name)

  constructor(
    private readonly cacheService: AppTechCacheService,
  ) { }

  private readonly getOpaqueServerStateCacheKey = (userName: string, deviceId: string) => `${WalnutAdminConstAppCacheKeys.AUTH_OPAQUE_STATE}:${userName}:${deviceId}:SERVER_STATE`

  /**
   * @description set OPAQUE server state cache
   */
  async setOpaqueServerStateCache(userName: string, deviceId: string, payload: string) {
    const cacheKey = this.getOpaqueServerStateCacheKey(userName, deviceId)
    await this.cacheService.set(cacheKey, payload, { t: WalnutAdminConstAppCacheType.AUTH, ttl: 30 })
    this.logger.debug(`Set OPAQUE server state cache: key => ${cacheKey}`)
  }

  /**
   * @description delete OPAQUE server state cache
   */
  async delOpaqueServerStateCache(userName: string, deviceId: string) {
    const cacheKey = this.getOpaqueServerStateCacheKey(userName, deviceId)
    await this.cacheService.del(cacheKey)
    this.logger.debug(`Delete OPAQUE server state cache: key => ${cacheKey}`)
  }

  /**
   * @description get OPAQUE server state cache
   */
  async getOpaqueServerStateCache(userName: string, deviceId: string) {
    const cacheKey = this.getOpaqueServerStateCacheKey(userName, deviceId)
    this.logger.debug(`Get OPAQUE server state cache: key => ${cacheKey}`)
    return this.cacheService.get<string>(cacheKey)
  }

  private readonly getOpaqueSessionKeyCacheKey = (userName: string, deviceId: string) => `${WalnutAdminConstAppCacheKeys.AUTH_OPAQUE_STATE}:${userName}:${deviceId}:SESSION_KEY`

  /**
   * @description set OPAQUE session key cache
   */
  async setOpaqueSessionKeyCache(userName: string, deviceId: string, payload: string) {
    const cacheKey = this.getOpaqueSessionKeyCacheKey(userName, deviceId)
    await this.cacheService.set(cacheKey, payload, { t: WalnutAdminConstAppCacheType.AUTH, ttl: 30 })
    this.logger.debug(`Set OPAQUE session key cache: key => ${cacheKey}`)
  }

  /**
   * @description delete OPAQUE session key cache
   */
  async delOpaqueSessionKeyCache(userName: string, deviceId: string) {
    const cacheKey = this.getOpaqueSessionKeyCacheKey(userName, deviceId)
    await this.cacheService.del(cacheKey)
    this.logger.debug(`Delete OPAQUE session key cache: key => ${cacheKey}`)
  }

  /**
   * @description get OPAQUE session key cache
   */
  async getOpaqueSessionKeyCache(userName: string, deviceId: string) {
    const cacheKey = this.getOpaqueSessionKeyCacheKey(userName, deviceId)
    this.logger.debug(`Get OPAQUE session key cache: key => ${cacheKey}`)
    return this.cacheService.get<string>(cacheKey)
  }
}

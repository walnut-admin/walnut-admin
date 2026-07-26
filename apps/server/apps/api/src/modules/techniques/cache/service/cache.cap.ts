import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { AppTechCacheAppSettingsService } from './cache.appSettings'

@Injectable()
export class AppTechCacheCapService {
  private readonly logger = new Logger(AppTechCacheCapService.name)

  constructor(
    private readonly cacheService: AppTechCacheService,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
  ) { }

  private readonly getCapTokenCacheKey = (deviceId: string) => `${WalnutAdminConstAppCacheKeys.SECURITY_CAP_TOKEN}:${deviceId}`

  /**
   * @description set OPAQUE server state cache
   */
  async setCapTokenCache(deviceId: string) {
    const cacheKey = this.getCapTokenCacheKey(deviceId)
    const config = await this.cacheAppSettingsService.getCapJSConfig()
    await this.cacheService.set(cacheKey, true, {
      t: WalnutAdminConstAppCacheType.AUTH,
      ttl: config.ttl,
    })
    this.logger.debug(`Set CAP token cache: key => ${cacheKey}`)
  }

  /**
   * @description delete CAP token cache
   */
  async delCapTokenCache(deviceId: string) {
    const cacheKey = this.getCapTokenCacheKey(deviceId)
    await this.cacheService.del(cacheKey)
    this.logger.debug(`Delete CAP token cache: key => ${cacheKey}`)
  }

  /**
   * @description get CAP token cache
   */
  async getCapTokenCache(deviceId: string) {
    const cacheKey = this.getCapTokenCacheKey(deviceId)
    this.logger.debug(`Get CAP token cache: key => ${cacheKey}`)
    return this.cacheService.get<boolean>(cacheKey)
  }
}

import { Injectable, Logger } from '@nestjs/common'
// Note: IWalnutAdminThrottleConfigProvider has been moved to global IWalnutAdminThrottleConfigProvider
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

@Injectable()
export class SecurityCapSettingService implements IWalnutAdminThrottleConfigProvider {
  private readonly logger = new Logger(SecurityCapSettingService.name)

  constructor(private readonly cacheAppSettingsService: AppTechCacheAppSettingsService) { }

  // implement IThrottleConfigProvider methods
  async getThrottleLimit() {
    const config = await this.cacheAppSettingsService.getCapJSConfig()

    const value = +config.throttleLimit

    this.logger.debug(`CAPJS throttle limit: ${value}`)

    return value
  }

  // implement IThrottleConfigProvider methods
  async getThrottleTtl() {
    const config = await this.cacheAppSettingsService.getCapJSConfig()

    const value = +config.throttleTtl

    this.logger.debug(`CAPJS throttle TTL: ${value}`)

    return value
  }
}

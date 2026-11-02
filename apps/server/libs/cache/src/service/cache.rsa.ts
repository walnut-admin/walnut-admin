import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminExceptionRsaPubKeyNotFound } from '@walnut-server/exceptions/business/rsa'
import { isNil } from 'lodash'
import { AppTechCacheService } from '../cache.service'

@Injectable()
export class AppTechCacheRsaService {
  private readonly logger = new Logger(AppTechCacheRsaService.name)

  constructor(private readonly cacheService: AppTechCacheService) {}

  async setRsaPubKeyCache(deviceId: string, payload: string) {
    this.logger.debug(`set rsa pub key cache, deviceId: ${deviceId}, payload: ${payload}`)
    await this.cacheService.set(`${WalnutAdminConstAppCacheKeys.SECURITY_RSA_PUB_KEY}:${deviceId}`, payload, { t: WalnutAdminConstAppCacheType.AUTH, ttl: 30 * 24 * 3600 })
  }

  async getRsaPubKeyCache(deviceId: string) {
    this.logger.debug(`get rsa pub key cache, deviceId: ${deviceId}`)
    const cached = this.cacheService.get<string>(`${WalnutAdminConstAppCacheKeys.SECURITY_RSA_PUB_KEY}:${deviceId}`)

    if (isNil(cached)) {
      throw new WalnutAdminExceptionRsaPubKeyNotFound()
    }

    return cached
  }
}

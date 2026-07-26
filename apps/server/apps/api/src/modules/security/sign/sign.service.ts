import { randomBytes } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { isNil } from 'lodash'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { AppTechCacheRsaService } from '@/modules/techniques/cache/service/cache.rsa'
import { AppTechCacheSignService } from '@/modules/techniques/cache/service/cache.sign'
import { SecuritySignHandShakeRequestDTO } from './sign.dto'

@Injectable()
export class SecuritySignService {
  private readonly logger = new Logger(SecuritySignService.name)

  constructor(
    private readonly cacheSignService: AppTechCacheSignService,
    private readonly cacheRsaService: AppTechCacheRsaService,
    private readonly appSettingCacheService: AppTechCacheAppSettingsService,
  ) { }

  /**
   * @description initial sign
   */
  async initial(deviceId: string, payload: SecuritySignHandShakeRequestDTO) {
    const { rsaPubKey, force = false } = payload

    const cached = await this.cacheRsaService.getRsaPubKeyCache(deviceId)
    if (!isNil(cached) && !force)
      return cached

    await this.cacheRsaService.setRsaPubKeyCache(deviceId, rsaPubKey)
    return true
  }

  /**
   * @description get session key
   */
  async getAesKey(deviceId: string) {
    // 1. should have rsa pubkey in cache
    await this.cacheRsaService.getRsaPubKeyCache(deviceId)

    const hkdfInfo = await this.appSettingCacheService.getCryptoHKDFInfo()
    const API_SIGN = hkdfInfo.API_SIGN

    const cached = await this.cacheSignService.getAesKeyCache(deviceId)
    if (!isNil(cached)) {
      return {
        aesKey: cached,
        hkdfInfo: API_SIGN,
      }
    }

    const newAesKey = randomBytes(32).toString('base64url')

    // set into cache
    await this.cacheSignService.setAesKeyCache(deviceId, newAesKey)

    return {
      aesKey: newAesKey,
      hkdfInfo: API_SIGN,
    }
  }
}

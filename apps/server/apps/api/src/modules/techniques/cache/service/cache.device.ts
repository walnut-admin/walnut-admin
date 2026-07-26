import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut/const/app/cache'
import { ISysDeviceDocument } from '@/modules/system/device/schema/device.schema'
import { AppTechCacheService } from '../cache.service'

interface DeviceCache {
  locked: boolean
  banned: boolean
  active: boolean
  currentIp: string
}

@Injectable()
export class AppTechCacheDeviceService {
  private readonly logger = new Logger(AppTechCacheDeviceService.name)

  constructor(
    private readonly cacheService: AppTechCacheService,
  ) { }

  private readonly getSysDeviceCacheKey = (deviceId: string) => `${WalnutAdminConstAppCacheKeys.SYS_DEVICE}:${deviceId}`

  /**
   * @description set system device cache
   */
  async setSysDeviceCache(device: ISysDeviceDocument) {
    const cacheKey = this.getSysDeviceCacheKey(device.deviceId)
    const payload: DeviceCache = {
      locked: device.locked,
      banned: device.banned,
      active: device.active,
      currentIp: device.ip,
    }
    await this.cacheService.set(cacheKey, payload, {
      t: WalnutAdminConstAppCacheType.SYSTEM,
    })
    this.logger.debug(`Set system device cache: key => ${cacheKey}`)
  }

  /**
   * @description delete system device cache
   */
  async delSysDeviceCache(devceId: string) {
    const cacheKey = this.getSysDeviceCacheKey(devceId)
    await this.cacheService.del(cacheKey)
    this.logger.debug(`Delete system device cache: key => ${cacheKey}`)
  }

  /**
   * @description get system device cache
   */
  async getSysDeviceCache(devceId: string) {
    const cacheKey = this.getSysDeviceCacheKey(devceId)
    this.logger.debug(`Get system device cache: key => ${cacheKey}`)
    return this.cacheService.get<DeviceCache>(cacheKey)
  }
}

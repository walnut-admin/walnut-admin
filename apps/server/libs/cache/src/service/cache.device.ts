import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminConstDeviceCookieRenewInterval } from '@walnut-server/const/app/cookie'
import { AppTechCacheService } from '../cache.service'

interface DeviceCache {
  locked: boolean
  banned: boolean
  active: boolean
  currentIp: string
}

/**
 * 写缓存只消费这几个字段 —— B6 起设备侧是 PG 实体（POJO），入参收成最小结构形状，
 * Mongo document 与 PG entity 都天然满足，techniques 层不反向依赖 device 模块内部类型。
 */
interface IDeviceCacheSource {
  deviceId: string
  locked: boolean
  banned: boolean
  active: boolean
  ip: string | null
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
  async setSysDeviceCache(device: IDeviceCacheSource) {
    const cacheKey = this.getSysDeviceCacheKey(device.deviceId)
    const payload: DeviceCache = {
      locked: device.locked,
      banned: device.banned,
      active: device.active,
      // Mongo 版即如此（列本可空、缓存类型标 string）：维持原类型契约与 guard 的
      // truthy 判空行为，这里只做签名适配
      currentIp: device.ip as string,
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

  private readonly getDeviceCookieRenewKey = (deviceId: string) =>
    `${WalnutAdminConstAppCacheKeys.SYS_DEVICE_COOKIE_RENEW}:${deviceId}`

  /**
   * @description 设备 cookie 滑动续期的时间闸（P0-1 后端纵深）
   *
   * 「cookie 剩余寿命」是浏览器侧的属性，服务端读不到（cookie 只有值、没有 exp）；
   * 因此把「上次续期时刻」记在 Redis 的单键上，TTL = 续期间隔 —— 键不存在即等价于
   * 「距上次续期已超过间隔」，调用方据此重发 cookie。用 setIfAbsent（SET NX EX）而不是
   * GET+SET：并发请求里只会有一次拿到 true，不会各自重发。
   *
   * @returns true = 本次抢到续期窗口（调用方应重发 DEVICE_ID cookie）
   */
  async markDeviceCookieRenewed(deviceId: string): Promise<boolean> {
    const written = await this.cacheService.setIfAbsent(
      this.getDeviceCookieRenewKey(deviceId),
      Date.now(),
      {
        t: WalnutAdminConstAppCacheType.SYSTEM,
        ttl: Math.max(1, Math.ceil(WalnutAdminConstDeviceCookieRenewInterval / 1000)),
      },
    )

    this.logger.debug(`Mark device cookie renewed: device => ${deviceId}, written => ${written}`)

    return written
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

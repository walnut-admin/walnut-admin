import { HttpService } from '@nestjs/axios'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminExceptionServiceUnavailableDependencyDown } from '@walnut-server/exceptions/base/503'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { Recordable } from 'easy-fns-ts'
import isLocalhostIp from 'is-localhost-ip'
import { isNil } from 'lodash'
import { ClientSession } from 'mongoose'
import { firstValueFrom } from 'rxjs'
import { SharedLocationDTO } from '@/common/dto/shared.dto'
import { AppSettingRepositoryService } from '@/modules/app/setting/repo/setting.repo.service'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

interface ISharedIpLocation extends SharedLocationDTO {
  ip: string
  countryCode?: string
  latitude?: number
  longitude?: number
  isp?: string
  timezone?: string
}

@Injectable()
export class SharedIpService {
  private readonly logger = new Logger(SharedIpService.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly redisService: AppTechRedisService,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly appSettingRepo: AppSettingRepositoryService,
  ) {}

  private readonly ipTempBlackListRedisKey = 'risk:ip_blacklist'
  private readonly ipTempBanTtl = 1800 // 30min

  private get redis() {
    return this.redisService.getClient()
  }

  /**
   *  @description get local location
   */
  getLocalLocation(ip: string): ISharedIpLocation {
    return {
      ip,
      country: 'LOCAL',
      region: 'LOCAL',
      city: 'LOCAL',
    }
  }

  /**
   * 标准�?IP address
   *
   * �?IP address中的冒号替换为下划线，方便作�?Redis key 使用
   * - 本地 IP 统一返回 '127.0.0.1'
   * - 其他 IP 直接将冒号替换为下划�?
   */
  async normalizeIp(rawIp?: string | null) {
    if (isNil(rawIp)) {
      return null
    }

    try {
      // 如果是本�?IP，统一返回 127.0.0.1
      const isLocal = await this.getIsLocalLocation(rawIp)
      if (isLocal) {
        return '127.0.0.1'
      }

      // 将冒号替换为下划�?
      return rawIp.replace(/:/g, '_')
    }
    catch {
      return null
    }
  }

  /**
   * @description check if ip is local
   */
  async getIsLocalLocation(ip: string) {
    return isLocalhostIp(ip)
  }

  /**
   * @description get blacklist info key
   */
  async getTempBlackListRedisKey(ip: string) {
    const normalizedIp = await this.normalizeIp(ip)
    return `${this.ipTempBlackListRedisKey}:${normalizedIp}`
  }

  /**
   * @description get global IP blacklist
   */
  async getPermanentBlackList(): Promise<string[]> {
    try {
      const appSetting = await this.cacheAppSettingsService.getAppSettings()
      return JSON.parse(appSetting[WalnutAdminConstAppSettingKeys.APP_GLOBAL_IP_BLACKLIST as keyof typeof appSetting]) as string[]
    }
    catch (error) {
      this.logger.error(error)
      return []
    }
  }

  /**
   * @description add ip to permanent blacklist
   */
  async addToPermanentBlackList(ip: string, dbSession?: ClientSession) {
    const ipKey = WalnutAdminConstAppSettingKeys.APP_GLOBAL_IP_BLACKLIST
    const oldValue = await this.appSettingRepo.findAppSettingByKey<string[]>(ipKey, dbSession)
    const newValue = oldValue ? oldValue.concat(ip) : [ip]
    await this.appSettingRepo.updateAppSettingByKey(ipKey, JSON.stringify(newValue), dbSession)
  }

  /**
   * @description remove ip from permanent blacklist
   */
  async removeFromPermanentBlackList(ip: string, dbSession?: ClientSession) {
    const ipKey = WalnutAdminConstAppSettingKeys.APP_GLOBAL_IP_BLACKLIST
    const oldValue = await this.appSettingRepo.findAppSettingByKey<string[]>(ipKey, dbSession)
    const newValue = oldValue ? oldValue.filter(item => item !== ip) : []
    await this.appSettingRepo.updateAppSettingByKey(ipKey, JSON.stringify(newValue), dbSession)
  }

  /**
   * @description add ip to temporary blacklist
   */
  async addToTemporaryBlacklist(
    ip: string,
    reason: string = 'TEMPORARY_BAN',
  ): Promise<void> {
    const infoKey = await this.getTempBlackListRedisKey(ip)
    const ttlSeconds = this.ipTempBanTtl

    await this.redis.hSet(infoKey, {
      ip,
      reason,
      permanent: 0,
      bannedAt: AppDayjs().valueOf(),
      expiresAt: AppDayjs().add(ttlSeconds, 'second').valueOf(),
    })
    await this.redis.expire(infoKey, ttlSeconds)

    this.logger.warn(
      `IP ${ip} added to temporary blacklist for ${ttlSeconds}s, reason: ${reason}`,
    )
  }

  /**
   * @description remove ip from temporary blacklist
   */
  async removeFromTemporaryBlacklist(ip: string): Promise<void> {
    const infoKey = await this.getTempBlackListRedisKey(ip)
    await this.redis.del(infoKey)
  }

  /**
   * @description check if ip is blacklisted
   */
  async isIpBlacklisted(ip: string): Promise<boolean> {
    // check permanent first
    const permanentBlacklist = await this.getPermanentBlackList()
    if (permanentBlacklist.includes(ip)) {
      return true
    }

    // check temporary blacklist
    const infoKey = await this.getTempBlackListRedisKey(ip)
    const isExisted = await this.redis.exists(infoKey)
    return isExisted === 1
  }

  /**
   * 获取 IP 位置信息（实际实�?- 使用免费 API�?
   */
  async getLocationInfoFromFreeAPI(ip: string): Promise<ISharedIpLocation> {
    const isLocal = await this.getIsLocalLocation(ip)

    if (isLocal) {
      return this.getLocalLocation(ip)
    }

    try {
      this.logger.log(`Fetching IP location for ${ip}`)

      const { data } = await firstValueFrom(this.httpService.get<Recordable>(`https://api.ip.sb/geoip/${ip}`))

      this.logger.log(`IP location API response data: ${JSON.stringify(data)}`)

      const location: ISharedIpLocation = {
        ip,
        countryCode: data.country_code as string,
        country: data.country as string,
        region: data.region as string,
        city: data.city as string,
        latitude: data.latitude as number,
        longitude: data.longitude as number,
        isp: data.isp as string,
        timezone: data.timezone as string,
      }

      this.logger.debug(
        `IP location resolved: ${ip} -> ${location.country}, ${location.city}`,
      )

      return location
    }
    catch (error) {
      this.logger.error(`Failed to fetch IP location for ${ip}`)
      this.logger.error(error)
      throw new WalnutAdminExceptionServiceUnavailableDependencyDown()
    }
  }

  /**
   * 获取 IP 位置信息
   */
  async getLocationFromBaidu(ip: string): Promise<string | null> {
    const isLocal = await this.getIsLocalLocation(ip)
    // 如果是本�?IP，直接返回本地位�?
    if (isLocal) {
      return 'LOCAL'
    }

    const baiduAK = this.configService.get<string>('vendor.baidu')

    if (isNil(baiduAK)) {
      throw new WalnutAdminExceptionServiceUnavailableDependencyDown()
    }

    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ status: number, content: Recordable }>(
          `http://api.map.baidu.com/location/ip`,
          {
            params: { ak: baiduAK, ip },
          },
        ),
      )

      if (data.status === 1001 || !Reflect.has(data.content, 'address')) {
        console.error('baidu location error', data)
        throw new WalnutAdminExceptionServiceUnavailableDependencyDown()
      }

      return data.content.address as string
    }
    catch (error) {
      console.error('baidu api error', error)
      throw new WalnutAdminExceptionServiceUnavailableDependencyDown()
    }
  }
}

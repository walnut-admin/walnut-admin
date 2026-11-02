import type { EntityManager } from 'typeorm'
import type { IWalnutAdminBlacklistRepository, IWalnutAdminIpLocationResolver } from './ip.ports'
import { HttpService } from '@nestjs/axios'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AppTechCacheAppSettingsService, AppTechRedisService } from '@walnut-server/cache'
import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminExceptionServiceUnavailableDependencyDown } from '@walnut-server/exceptions/base/503'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { Recordable } from 'easy-fns-ts'
import isLocalhostIp from 'is-localhost-ip'
import { isNil } from 'lodash'
import { firstValueFrom } from 'rxjs'
import { WALNUT_ADMIN_BLACKLIST_REPOSITORY } from './ip.ports'

/**
 * 归属地三字段（country / region / city）的**结构化契约**，本 lib 对外导出。
 *
 * 为什么在这里、而不是 `@walnut-server/list` 的 wire DTO `SharedLocationDTO`：
 * list 属 tech-assemble、本 lib 属 tech-base，base → assemble 是 F-14 禁止的反向边
 * （eslint 会红），所以同型声明只能下沉到两侧都能引的层 —— 而 `libs/types` 按契约只有
 * 全局 `.d.ts` 声明（无运行时、无装饰器），放不下带装饰器的 DTO 类。
 *
 * 因此分工是：「字段名 / 类型」以本接口为准（wire DTO 侧用编译期断言钉住，
 * 见 `libs/list/src/shared-location.contract.ts`），「装饰器 + swagger 元数据」
 * 以 `SharedLocationDTO` 为准。任一侧改名或改类型，`types:check` 立刻红 —— 不再靠
 * 注释里的「记得同步」。
 */
export interface ISharedIpLocationCore {
  country: string
  region: string
  city: string
}

/**
 * IP 位置的内部形状（含 `ip` 与可选的坐标 / ISP / 时区）。消费方（system/device、
 * security/risk）只按结构读，wire 零变化。
 */
interface ISharedIpLocation extends ISharedIpLocationCore {
  ip: string
  countryCode?: string
  latitude?: number
  longitude?: number
  isp?: string
  timezone?: string
}

// implements 是端口绑定的编译期守护：操作日志拦截器（libs/crud）只依赖本 lib 的
// IWalnutAdminIpLocationResolver 端口（F-14 起 token + 接口随实现落在 libs/ip，crud → ip
// 是 assemble → base 的合法方向）；永久黑名单存储经 WALNUT_ADMIN_BLACKLIST_REPOSITORY 由
// libs/app-domain 的 AppSettingRepositoryService 提供（批 5）—— 任一方法改名/改签名，这里立刻红
@Injectable()
export class SharedIpService implements IWalnutAdminIpLocationResolver {
  private readonly logger = new Logger(SharedIpService.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly redisService: AppTechRedisService,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    @Inject(WALNUT_ADMIN_BLACKLIST_REPOSITORY)
    private readonly appSettingRepo: IWalnutAdminBlacklistRepository,
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
   * 标准化 IP address
   *
   * 将 IP address 中的冒号替换为下划线，方便作为 Redis key 使用
   * - 本地 IP 统一返回 '127.0.0.1'
   * - 其他 IP 直接将冒号替换为下划线
   */
  async normalizeIp(rawIp?: string | null) {
    if (isNil(rawIp)) {
      return null
    }

    try {
      // 如果是本地 IP，统一返回 127.0.0.1
      const isLocal = await this.getIsLocalLocation(rawIp)
      if (isLocal) {
        return '127.0.0.1'
      }

      // 将冒号替换为下划线
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
  async addToPermanentBlackList(ip: string, em?: EntityManager) {
    const ipKey = WalnutAdminConstAppSettingKeys.APP_GLOBAL_IP_BLACKLIST
    const oldValue = await this.appSettingRepo.findAppSettingByKey<string[]>(ipKey, em)
    const newValue = oldValue ? oldValue.concat(ip) : [ip]
    await this.appSettingRepo.updateAppSettingByKey(ipKey, JSON.stringify(newValue), em)
  }

  /**
   * @description remove ip from permanent blacklist
   */
  async removeFromPermanentBlackList(ip: string, em?: EntityManager) {
    const ipKey = WalnutAdminConstAppSettingKeys.APP_GLOBAL_IP_BLACKLIST
    const oldValue = await this.appSettingRepo.findAppSettingByKey<string[]>(ipKey, em)
    const newValue = oldValue ? oldValue.filter(item => item !== ip) : []
    await this.appSettingRepo.updateAppSettingByKey(ipKey, JSON.stringify(newValue), em)
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
   * 获取 IP 位置信息（实际实现 - 使用免费 API）
   */
  async getLocationInfoFromFreeAPI(ip: string): Promise<ISharedIpLocation> {
    const isLocal = await this.getIsLocalLocation(ip)

    if (isLocal) {
      return this.getLocalLocation(ip)
    }

    try {
      this.logger.log(`Fetching IP location for ${ip}`)

      const { data } = await firstValueFrom(this.httpService.get<Recordable>(`https://api.ip.sb/geoip/${ip}`))

      // F-06：原日志 dump 全量地理位置响应（含经纬度/ISP 等），改为最小可排障字段
      this.logger.log(`IP location API resolved: ${data.country_code ?? '?'} / ${data.city ?? '?'}`)

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
    // 如果是本地 IP，直接返回本地位置
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
        // F-16：原裸 console.error 绕过日志管道（无 requestId、不进轮转），改走已注入的 Nest Logger；
        // 与 F-06 同口径只记最小可排障字段（错误 status），不再 dump 整个百度响应体
        this.logger.error(`baidu location error, status: ${data.status}`)
        throw new WalnutAdminExceptionServiceUnavailableDependencyDown()
      }

      return data.content.address as string
    }
    catch (error) {
      this.logger.error('baidu api error', error)
      throw new WalnutAdminExceptionServiceUnavailableDependencyDown()
    }
  }
}

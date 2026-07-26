import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys } from '@walnut/const/app/cache'
import { AppDayjs } from '@walnut/utils/dayjs'
import { isNil } from 'lodash'
import { MurLockService } from 'murlock'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
import {
  calcScoreAndLevel,
  SecurityRiskConfigService,
  WalnutAdminConstRiskFactor,
  WalnutAdminConstRiskLevel,
  WalnutAdminConstRiskType,
} from '../risk.config.service'

@Injectable()
export class SecurityRiskLocationService {
  private readonly logger = new Logger(SecurityRiskLocationService.name)

  constructor(
    private readonly redisService: AppTechRedisService,
    private readonly configService: SecurityRiskConfigService,
    private readonly sharedIpService: SharedIpService,
    private readonly murLockService: MurLockService,
  ) {}

  private get redis() {
    return this.redisService.getClient()
  }

  private async getInfoKey(ip: string) {
    const normalizedIp = await this.sharedIpService.normalizeIp(ip)
    const key = this.configService.redis.location
    return `${key}:${normalizedIp}`
  }

  async evaluateLocationRisk(ip: string): Promise<IWalnutAdminRiskEvaluationResult<IWalnutAdminLocationRiskInfo>> {
    const locationRiskKey = await this.getInfoKey(ip)
    const cached = await this.redis.get(locationRiskKey) as string

    let locationInfo: IWalnutAdminLocationRiskInfo | null

    if (cached) {
      try {
        locationInfo = JSON.parse(cached) as IWalnutAdminLocationRiskInfo
      }
      catch {
        this.logger.warn(`Failed to parse cached location risk for ${ip}`)
        locationInfo = await this.evaluateLocationRiskWithLock(ip)
      }
    }
    else {
      locationInfo = await this.evaluateLocationRiskWithLock(ip)
    }

    if (locationInfo === null) {
      return {
        type: WalnutAdminConstRiskType.LOCATION,
        score: 0,
        level: WalnutAdminConstRiskLevel.LOW,
        factors: [],
        evaluatedAt: AppDayjs().unix(),
        details: null,
      }
    }

    return {
      type: WalnutAdminConstRiskType.LOCATION,
      score: locationInfo.score,
      level: locationInfo.level,
      factors: locationInfo.factors,
      evaluatedAt: locationInfo.evaluatedAt,
      details: locationInfo,
    }
  }

  private async evaluateLocationRiskWithLock(ip: string) {
    const normalizedIP = await this.sharedIpService.normalizeIp(ip)
    const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:RISK:LOCATION:${normalizedIP}`

    return this.murLockService.runWithLock<IWalnutAdminLocationRiskInfo | null>(
      lockKey,
      200,
      async () => {
        const infoKey = await this.getInfoKey(ip)
        const doubleCheck = await this.redis.get(infoKey) as string

        if (doubleCheck) {
          try {
            return JSON.parse(doubleCheck) as IWalnutAdminLocationRiskInfo
          }
          catch {}
        }

        return this.performLocationEvaluation(ip)
      },
    )
  }

  private async performLocationEvaluation(ip: string) {
    const location = await this.sharedIpService.getLocationInfoFromFreeAPI(ip)

    let score = 0
    const factors: string[] = []

    if (this.configService.highRiskCountries.has(location.country)) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.LOCATION_HIGH_RISK_COUNTRY)
      factors.push(WalnutAdminConstRiskFactor.LOCATION_HIGH_RISK_COUNTRY)
    }

    const isVpnOrProxy = this.detectVpnOrProxy(location)
    if (isVpnOrProxy) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.LOCATION_VPN_OR_PROXY)
      factors.push(WalnutAdminConstRiskFactor.LOCATION_VPN_OR_PROXY)
    }

    const { score: finalScore, level } = calcScoreAndLevel(score)

    const result = {
      ip,
      location,
      score: finalScore,
      factors,
      level,
      evaluatedAt: AppDayjs().valueOf(),
    }

    const locationRiskKey = await this.getInfoKey(ip)
    await this.redis.setEx(
      locationRiskKey,
      this.configService.ttl.location,
      JSON.stringify(result),
    )

    if (level === WalnutAdminConstRiskLevel.HIGH || level === WalnutAdminConstRiskLevel.CRITICAL) {
      this.logger.warn(
        `High risk location detected - IP: ${ip}, Country: ${location.country}, `
        + `Level: ${level}, Factors: [${factors.join(', ')}]`,
      )
    }
    else {
      this.logger.debug(
        `Location evaluated - IP: ${ip}, Score: ${finalScore.toFixed(3)}, `
        + `Level: ${level}, Factors: [${factors.join(', ')}]`,
      )
    }

    return result
  }

  private detectVpnOrProxy(location: IWalnutAdminIpLocationInfo): boolean {
    if (isNil(location.isp))
      return false
    const ispLower = location.isp.toLowerCase()
    return this.configService.vpnKeywords.some(keyword => ispLower.includes(keyword))
  }

  async clearLocationCache(ip: string): Promise<void> {
    const locationKey = await this.getInfoKey(ip)
    await this.redis.del(locationKey)
    this.logger.log(`Cleared location cache for IP ${ip}`)
  }
}

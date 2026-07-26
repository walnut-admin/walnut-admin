import { Injectable, Logger } from '@nestjs/common'
import { AppDayjs } from '@walnut/utils/dayjs'
import { isNil } from 'lodash'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
import { calcScoreAndLevel, SecurityRiskConfigService, WalnutAdminConstRiskFactor, WalnutAdminConstRiskLevel, WalnutAdminConstRiskType } from '../risk.config.service'

@Injectable()
export class SecurityRiskIPService {
  private readonly logger = new Logger(SecurityRiskIPService.name)

  constructor(
    private readonly redisService: AppTechRedisService,
    private readonly configService: SecurityRiskConfigService,
    private readonly sharedIpService: SharedIpService,
  ) {}

  private get redis() {
    return this.redisService.getClient()
  }

  /**
   * @description evaluate ip risk
   */
  async evaluateIP(ip: string): Promise<IWalnutAdminRiskEvaluationResult<IWalnutAdminIpBlacklistInfo>> {
    const infoKey = await this.sharedIpService.getTempBlackListRedisKey(ip)
    const cached = await this.redis.hGetAll(infoKey) as unknown as IWalnutAdminIpBlacklistInfo

    if (isNil(cached) || Object.keys(cached).length === 0) {
      return {
        type: WalnutAdminConstRiskType.IP,
        score: 0,
        level: WalnutAdminConstRiskLevel.LOW,
        factors: [],
        evaluatedAt: AppDayjs().valueOf(),
        details: undefined,
      }
    }

    let score = 0
    const factors: string[] = []

    if (cached.permanent) {
      score = this.configService.getWeight(WalnutAdminConstRiskFactor.IP_BLACKLIST_PERMANENT)
      factors.push(WalnutAdminConstRiskFactor.IP_BLACKLIST_PERMANENT)
    }
    else {
      score = this.configService.getWeight(WalnutAdminConstRiskFactor.IP_BLACKLIST_TEMPORARY)
      factors.push(WalnutAdminConstRiskFactor.IP_BLACKLIST_TEMPORARY)
    }

    const { score: finalScore, level } = calcScoreAndLevel(score)

    return {
      type: WalnutAdminConstRiskType.IP,
      score: finalScore,
      level,
      factors,
      evaluatedAt: AppDayjs().valueOf(),
      details: cached,
    }
  }
}

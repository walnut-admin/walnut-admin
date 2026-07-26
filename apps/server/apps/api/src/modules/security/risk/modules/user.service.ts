import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { MurLockService } from 'murlock'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserIdentityRepositoryService } from '@/modules/system/user_identity/repo/user_identity.repo.service'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
import {
  calcScoreAndLevel,
  SecurityRiskConfigService,
  WalnutAdminConstRiskFactor,
  WalnutAdminConstRiskLevel,
  WalnutAdminConstRiskType,
} from '../risk.config.service'

@Injectable()
export class SecurityRiskUserService {
  private readonly logger = new Logger(SecurityRiskUserService.name)

  constructor(
    private readonly redisService: AppTechRedisService,
    private readonly configService: SecurityRiskConfigService,
    private readonly userRepository: SysUserRepositoryService,
    private readonly userIdentityRepo: SysUserIdentityRepositoryService,
    private readonly murLockService: MurLockService,
  ) {}

  private get redis() {
    return this.redisService.getClient()
  }

  private getInfoKey(userId: string) {
    const key = this.configService.redis.userInfo
    return `${key}:${userId}`
  }

  async evaluateUser(userId: string): Promise<IWalnutAdminRiskEvaluationResult<IWalnutAdminUserRiskInfo>> {
    const infoKey = this.getInfoKey(userId)
    const cached = await this.redis.get(infoKey) as string

    let userInfo: IWalnutAdminUserRiskInfo | null

    if (cached) {
      try {
        userInfo = JSON.parse(cached) as IWalnutAdminUserRiskInfo
      }
      catch {
        this.logger.warn(`Failed to parse cached user info for ${userId}`)
        userInfo = await this.evaluateUserWithLock(userId)
      }
    }
    else {
      userInfo = await this.evaluateUserWithLock(userId)
    }

    if (!userInfo) {
      return {
        type: WalnutAdminConstRiskType.USER,
        score: 0,
        level: WalnutAdminConstRiskLevel.LOW,
        factors: [],
        evaluatedAt: AppDayjs().unix(),
        details: null,
      }
    }

    return {
      type: WalnutAdminConstRiskType.USER,
      score: userInfo.score,
      level: userInfo.level,
      factors: userInfo.factors,
      evaluatedAt: userInfo.evaluatedAt,
      details: userInfo,
    }
  }

  private async evaluateUserWithLock(userId: string) {
    const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:RISK:USER:${userId}`

    return this.murLockService.runWithLock(
      lockKey,
      200,
      async () => {
        const infoKey = this.getInfoKey(userId)
        const doubleCheck = await this.redis.get(infoKey) as string

        if (doubleCheck) {
          try {
            return JSON.parse(doubleCheck) as IWalnutAdminUserRiskInfo
          }
          catch {}
        }

        return this.performUserEvaluation(userId)
      },
    )
  }

  private async performUserEvaluation(userId: string) {
    let score = 0
    const factors: string[] = []

    const user = await this.userRepository.findUserByUserId(userId)
    if (!user) {
      return null
    }

    // Check password identity from user_identity table
    const passwordIdentity = await this.userIdentityRepo.findByUserIdTypeAndPurpose(
      userId,
      'password',
      'login',
    )
    const hasPassword = passwordIdentity !== null

    if (!user.status) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.USER_DISABLED)
      factors.push(WalnutAdminConstRiskFactor.USER_DISABLED)
    }

    if (!hasPassword) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.USER_NO_PASSWORD)
      factors.push(WalnutAdminConstRiskFactor.USER_NO_PASSWORD)
    }

    if (!user.mfaSetup) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.USER_NO_MFA)
      factors.push(WalnutAdminConstRiskFactor.USER_NO_MFA)
    }

    const { score: finalScore, level } = calcScoreAndLevel(score)

    const result: IWalnutAdminUserRiskInfo = {
      userId,
      score: finalScore,
      factors,
      level,
      evaluatedAt: AppDayjs().valueOf(),
      accountDisabled: !user.status,
      noRegistration: !hasPassword,
      noMfa: !user.mfaSetup,
    }

    const infoKey = this.getInfoKey(userId)
    await this.redis.setEx(
      infoKey,
      this.configService.ttl.userInfo,
      JSON.stringify(result),
    )

    this.logger.debug(
      `User evaluated - ID: ${userId}, Score: ${finalScore.toFixed(3)}, `
      + `Level: ${level}, Factors: [${factors.join(', ')}]`,
    )

    return result
  }

  async clearUserCache(userId: string): Promise<void> {
    const infoKey = this.getInfoKey(userId)
    await this.redis.del(infoKey)
    this.logger.log(`Cleared user cache for ${userId}`)
  }
}

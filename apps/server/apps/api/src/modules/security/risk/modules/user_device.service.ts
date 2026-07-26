import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys } from '@walnut/const/app/cache'
import { AppDayjs } from '@walnut/utils/dayjs'
import { MurLockService } from 'murlock'
import { SysUserDeviceRepositoryService } from '@/modules/system/user_device/repo/user_device.repo.service'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
import {
  calcScoreAndLevel,
  SecurityRiskConfigService,
  WalnutAdminConstRiskFactor,
  WalnutAdminConstRiskLevel,
  WalnutAdminConstRiskType,
} from '../risk.config.service'

@Injectable()
export class SecurityRiskUserDeviceService {
  private readonly logger = new Logger(SecurityRiskUserDeviceService.name)

  constructor(
    private readonly redisService: AppTechRedisService,
    private readonly configService: SecurityRiskConfigService,
    private readonly userDeviceRepo: SysUserDeviceRepositoryService,
    private readonly murLockService: MurLockService,
  ) {}

  private get redis() {
    return this.redisService.getClient()
  }

  private getInfoKey(userId: string, deviceId: string) {
    const key = this.configService.redis.userDeviceInfo
    return `${key}:${userId}:${deviceId}`
  }

  async evaluateUserDevice(userId: string, deviceId: string): Promise<IWalnutAdminRiskEvaluationResult<IWalnutAdminUserDeviceRiskInfo>> {
    const infoKey = this.getInfoKey(userId, deviceId)
    const cached = await this.redis.get(infoKey) as string

    let userDeviceInfo: IWalnutAdminUserDeviceRiskInfo | null

    if (cached) {
      try {
        userDeviceInfo = JSON.parse(cached) as IWalnutAdminUserDeviceRiskInfo
      }
      catch {
        this.logger.warn(`Failed to parse cached user device info for ${userId}:${deviceId}`)
        userDeviceInfo = await this.evaluateUserDeviceWithLock(userId, deviceId)
      }
    }
    else {
      userDeviceInfo = await this.evaluateUserDeviceWithLock(userId, deviceId)
    }

    if (!userDeviceInfo) {
      return {
        type: WalnutAdminConstRiskType.USER_DEVICE,
        score: 0,
        level: WalnutAdminConstRiskLevel.LOW,
        factors: [],
        evaluatedAt: AppDayjs().unix(),
        details: null,
      }
    }

    return {
      type: WalnutAdminConstRiskType.USER_DEVICE,
      score: userDeviceInfo.score,
      level: userDeviceInfo.level,
      factors: userDeviceInfo.factors,
      evaluatedAt: userDeviceInfo.evaluatedAt,
      details: userDeviceInfo,
    }
  }

  private async evaluateUserDeviceWithLock(userId: string, deviceId: string) {
    const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:RISK:USER_DEVICE:${userId}:${deviceId}`

    return this.murLockService.runWithLock(
      lockKey,
      200,
      async () => {
        const infoKey = this.getInfoKey(userId, deviceId)
        const doubleCheck = await this.redis.get(infoKey) as string

        if (doubleCheck) {
          try {
            return JSON.parse(doubleCheck) as IWalnutAdminUserDeviceRiskInfo
          }
          catch {}
        }

        return this.performUserDeviceEvaluation(userId, deviceId)
      },
    )
  }

  private async performUserDeviceEvaluation(userId: string, deviceId: string) {
    let score = 0
    const factors: string[] = []

    const userDevice = await this.userDeviceRepo.findByUserAndDevice(userId, deviceId)
    if (!userDevice) {
      return null
    }
    const trustExpired = this.userDeviceRepo.getIsDeviceExpired(userDevice?.trustedExpiredAt)

    if (!userDevice.trusted) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.USER_DEVICE_UNTRUSTED)
      factors.push(WalnutAdminConstRiskFactor.USER_DEVICE_UNTRUSTED)
    }

    if (trustExpired) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.USER_DEVICE_TRUST_EXPIRED)
      factors.push(WalnutAdminConstRiskFactor.USER_DEVICE_TRUST_EXPIRED)
    }

    if (userDevice.locked) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.USER_DEVICE_LOCKED)
      factors.push(WalnutAdminConstRiskFactor.USER_DEVICE_LOCKED)
    }

    if (this.userDeviceRepo.getIsDeviceInactive(userDevice.lastActiveAt, this.configService.thresholds.userDevice.inactiveDays)) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.USER_DEVICE_INACTIVE)
      factors.push(WalnutAdminConstRiskFactor.USER_DEVICE_INACTIVE)
    }

    const { score: finalScore, level } = calcScoreAndLevel(score)

    const result: IWalnutAdminUserDeviceRiskInfo = {
      userId,
      deviceId,
      score: finalScore,
      factors,
      level,
      evaluatedAt: AppDayjs().valueOf(),
      isTrusted: userDevice.trusted,
      isLocked: userDevice.locked,
      trustExpired,
      lastActiveAt: AppDayjs(userDevice.lastActiveAt).valueOf(),
    }

    const infoKey = this.getInfoKey(userId, deviceId)
    await this.redis.setEx(
      infoKey,
      this.configService.ttl.userDeviceInfo,
      JSON.stringify(result),
    )

    this.logger.debug(
      `UserDevice evaluated - User: ${userId}, Device: ${deviceId}, Score: ${finalScore.toFixed(3)}, `
      + `Level: ${level}, Factors: [${factors.join(', ')}]`,
    )

    return result
  }

  async clearUserDeviceCache(userId: string, deviceId: string): Promise<void> {
    const infoKey = this.getInfoKey(userId, deviceId)
    await this.redis.del(infoKey)
    this.logger.log(`Cleared user device cache for ${userId}:${deviceId}`)
  }
}

import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys } from '@walnut/const/app/cache'
import { AppDayjs } from '@walnut/utils/dayjs'
import { MurLockService } from 'murlock'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { SysDeviceRepositoryService } from '@/modules/system/device/repo/device.repo.service'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
import {
  calcScoreAndLevel,
  SecurityRiskConfigService,
  WalnutAdminConstRiskFactor,
  WalnutAdminConstRiskLevel,
  WalnutAdminConstRiskType,
} from '../risk.config.service'

@Injectable()
export class SecurityRiskDeviceService {
  private readonly logger = new Logger(SecurityRiskDeviceService.name)

  constructor(
    private readonly redisService: AppTechRedisService,
    private readonly configService: SecurityRiskConfigService,
    private readonly deviceRepoService: SysDeviceRepositoryService,
    private readonly murLockService: MurLockService,
    private readonly sharedIpService: SharedIpService,
  ) {}

  private get redis() {
    return this.redisService.getClient()
  }

  private getInfoKey(deviceId: string) {
    const key = this.configService.redis.deviceInfo
    return `${key}:${deviceId}`
  }

  async evaluateDevice(deviceId: string): Promise<IWalnutAdminRiskEvaluationResult<IWalnutAdminDeviceRiskInfo>> {
    const infoKey = this.getInfoKey(deviceId)
    const cached = await this.redis.get(infoKey) as string

    let deviceInfo: IWalnutAdminDeviceRiskInfo | null

    if (cached) {
      try {
        deviceInfo = JSON.parse(cached) as IWalnutAdminDeviceRiskInfo
      }
      catch {
        this.logger.warn(`Failed to parse cached device info for ${deviceId}`)
        deviceInfo = await this.evaluateDeviceWithLock(deviceId)
      }
    }
    else {
      deviceInfo = await this.evaluateDeviceWithLock(deviceId)
    }

    if (deviceInfo === null) {
      return {
        type: WalnutAdminConstRiskType.DEVICE,
        score: 0,
        level: WalnutAdminConstRiskLevel.LOW,
        factors: [],
        evaluatedAt: AppDayjs().unix(),
        details: null,
      }
    }

    return {
      type: WalnutAdminConstRiskType.DEVICE,
      score: deviceInfo.score,
      level: deviceInfo.level,
      factors: deviceInfo.factors,
      evaluatedAt: deviceInfo.evaluatedAt,
      details: deviceInfo,
    }
  }

  private async evaluateDeviceWithLock(deviceId: string) {
    const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:RISK:DEVICE:${deviceId}`

    return this.murLockService.runWithLock<IWalnutAdminDeviceRiskInfo | null>(
      lockKey,
      200,
      async () => {
        const infoKey = this.getInfoKey(deviceId)
        const doubleCheck = await this.redis.get(infoKey) as string

        if (doubleCheck) {
          try {
            return JSON.parse(doubleCheck) as IWalnutAdminDeviceRiskInfo
          }
          catch {}
        }

        return this.performDeviceEvaluation(deviceId)
      },
    )
  }

  private async performDeviceEvaluation(deviceId: string) {
    let score = 0
    const factors: string[] = []

    const device = await this.deviceRepoService.findDeviceByDeviceId(deviceId)
    if (!device) {
      return null
    }

    const daysSinceCreated = this.deviceRepoService.getDeviceCreatedDays(device.createdAt as Date)

    if (daysSinceCreated < this.configService.thresholds.device.newDeviceDays) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.DEVICE_NEW)
      factors.push(WalnutAdminConstRiskFactor.DEVICE_NEW)
    }
    else if (daysSinceCreated < this.configService.thresholds.device.recentDeviceDays) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.DEVICE_RECENT)
      factors.push(WalnutAdminConstRiskFactor.DEVICE_RECENT)
    }

    if (device.ipHistory.length && device.ipHistory.length > 0) {
      const latestIp = device.ipHistory.at(-1) ?? ''
      const isBlacklisted = await this.sharedIpService.isIpBlacklisted(latestIp)
      if (isBlacklisted) {
        score += this.configService.getWeight(WalnutAdminConstRiskFactor.DEVICE_CURRENT_IP_BLACKLISTED)
        factors.push(WalnutAdminConstRiskFactor.DEVICE_CURRENT_IP_BLACKLISTED)
      }

      const hasHistoryBlacklisted = await Promise.all(device.ipHistory.map(async ip => this.sharedIpService.isIpBlacklisted(ip)))
      if (hasHistoryBlacklisted.some(Boolean)) {
        score += this.configService.getWeight(WalnutAdminConstRiskFactor.DEVICE_HISTORY_IP_BLACKLISTED)
        factors.push(WalnutAdminConstRiskFactor.DEVICE_HISTORY_IP_BLACKLISTED)
      }
    }

    if (device.banned) {
      score = this.configService.getWeight(WalnutAdminConstRiskFactor.DEVICE_BANNED)
      factors.push(WalnutAdminConstRiskFactor.DEVICE_BANNED)
    }

    if (device.locked) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.DEVICE_LOCKED)
      factors.push(WalnutAdminConstRiskFactor.DEVICE_LOCKED)
    }

    if (device.private) {
      score += this.configService.getWeight(WalnutAdminConstRiskFactor.DEVICE_PRIVATE)
      factors.push(WalnutAdminConstRiskFactor.DEVICE_PRIVATE)
    }

    const { score: finalScore, level } = calcScoreAndLevel(score)

    const result: IWalnutAdminDeviceRiskInfo = {
      deviceId,
      score: finalScore,
      factors,
      level,
      evaluatedAt: AppDayjs().valueOf(),
      isNewDevice: daysSinceCreated < this.configService.thresholds.device.newDeviceDays,
      isBanned: device.banned,
      isLocked: device.locked,
      daysSinceCreated,
    }

    const infoKey = this.getInfoKey(deviceId)
    await this.redis.setEx(
      infoKey,
      this.configService.ttl.deviceInfo,
      JSON.stringify(result),
    )

    if (level === WalnutAdminConstRiskLevel.HIGH || level === WalnutAdminConstRiskLevel.CRITICAL) {
      this.logger.warn(
        `High risk device detected - Device: ${deviceId}, Score: ${finalScore.toFixed(3)}, `
        + `Level: ${level}, Factors: [${factors.join(', ')}]`,
      )
    }
    else {
      this.logger.debug(
        `Device evaluated - ID: ${deviceId}, Score: ${finalScore.toFixed(3)}, `
        + `Level: ${level}, Factors: [${factors.join(', ')}]`,
      )
    }

    return result
  }

  async clearDeviceCache(deviceId: string): Promise<void> {
    const infoKey = this.getInfoKey(deviceId)
    await this.redis.del(infoKey)
    this.logger.log(`Cleared device cache for ${deviceId}`)
  }
}

import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys } from '@walnut/const/app/cache'
import { IWalnutAdminConstDecoratorLogAuthType } from '@walnut/const/decorator/logAuth'
import { AppDayjs } from '@walnut/utils/dayjs'
import { isNil } from 'lodash'
import { MurLockService } from 'murlock'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
import { calcScoreAndLevel, SecurityRiskConfigService, WalnutAdminConstRiskFactor, WalnutAdminConstRiskType } from '../risk.config.service'

/**
 * Failed login risk assessment service.
 * Tracks failed login attempts and triggers IP blacklisting when thresholds are exceeded.
 */
@Injectable()
export class SecurityRiskFailedLoginService {
  private readonly logger = new Logger(SecurityRiskFailedLoginService.name)

  constructor(
    private readonly redisService: AppTechRedisService,
    private readonly configService: SecurityRiskConfigService,
    private readonly sharedIpService: SharedIpService,
    private readonly murLockService: MurLockService,
  ) {}

  private get redis() {
    return this.redisService.getClient()
  }

  private getInfoKey(deviceId: string, identifier?: string) {
    const key = this.configService.redis.failedLoginInfo
    return `${key}:${identifier}:${deviceId}`
  }

  /**
   * Collect a failed login attempt and trigger IP blacklisting if threshold exceeded.
   * Uses MurLock to prevent race conditions when multiple failed logins occur simultaneously.
   */
  async collect(payload: IWalnutAdminRecordFailedLoginPayload): Promise<number> {
    const { identifier, loginType, deviceId, ip, reason } = payload

    const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:RISK:FAILED_LOGIN:${deviceId}:${identifier ?? 'unknown'}`

    return this.murLockService.runWithLock<number>(
      lockKey,
      200,
      async () => {
        const infoKey = this.getInfoKey(deviceId, identifier)

        const count = await this.redis.hIncrBy(infoKey, 'count', 1)

        await this.redis.hSet(infoKey, {
          identifier: identifier ?? '',
          loginType: loginType ?? '',
          deviceId,
          ip,
          reason,
          lastFailedAt: AppDayjs().valueOf(),
        })
        await this.redis.expire(infoKey, this.configService.ttl.failedLogin)

        this.logger.warn(
          `Failed login attempt [${count}/${this.configService.thresholds.failedLogin.threshold}] - `
          + `${loginType}: ${identifier}, Device: ${deviceId}, IP: ${ip}, Reason: ${reason}`,
        )

        if (count >= this.configService.thresholds.failedLogin.threshold) {
          await this.sharedIpService.addToTemporaryBlacklist(
            ip,
            `Too many failed login attempts (${count} times)`,
          )

          this.logger.error(
            `?IP ${ip} has been temporarily banned for ${this.configService.ttl.ipTempBan}s `
            + `due to ${count} failed login attempts`,
          )
        }

        return count
      },
    )
  }

  async evaluateFailedLogin(
    deviceId: string,
    identifier?: string,
  ): Promise<IWalnutAdminRiskEvaluationResult<IWalnutAdminFailedLoginInfo>> {
    const failedLoginInfo = await this.getIWalnutAdminFailedLoginInfo(deviceId, identifier)

    let score = 0
    const factors: string[] = []

    if (failedLoginInfo && failedLoginInfo.count > 0) {
      score += failedLoginInfo.count * this.configService.getWeight(WalnutAdminConstRiskFactor.FAILED_LOGINS)
      factors.push(WalnutAdminConstRiskFactor.FAILED_LOGINS)
    }

    const { score: finalScore, level } = calcScoreAndLevel(score)

    return {
      type: WalnutAdminConstRiskType.FAILED_LOGIN,
      score: finalScore,
      level,
      factors,
      evaluatedAt: AppDayjs().valueOf(),
      details: failedLoginInfo,
    }
  }

  async getIWalnutAdminFailedLoginInfo(
    deviceId: string,
    identifier?: string,
  ): Promise<IWalnutAdminFailedLoginInfo | null> {
    const infoKey = this.getInfoKey(deviceId, identifier)
    const info = await this.redis.hGetAll(infoKey)

    if (isNil(info) || Object.keys(info).length === 0) {
      return null
    }

    return {
      identifier: info.identifier || undefined,
      loginType: info.loginType as IWalnutAdminConstDecoratorLogAuthType || undefined,
      deviceId: info.deviceId,
      ip: info.ip,
      count: Number.parseInt(info.count, 10) || 0,
      lastFailedAt: Number.parseInt(info.lastFailedAt, 10),
      reason: info.reason,
    }
  }

  async getFailedLoginAttempts(
    deviceId: string,
    identifier?: string,
  ): Promise<number> {
    const infoKey = this.getInfoKey(deviceId, identifier)
    const count = await this.redis.hGet(infoKey, 'count') as string
    return count ? Number.parseInt(count, 10) : 0
  }

  async clearFailedLoginAttempts(
    deviceId: string,
    identifier?: string,
  ): Promise<void> {
    const infoKey = this.getInfoKey(deviceId, identifier)
    await this.redis.del(infoKey)

    this.logger.log(
      `Cleared failed login attempts for identifier: ${identifier}, device: ${deviceId}`,
    )
  }
}

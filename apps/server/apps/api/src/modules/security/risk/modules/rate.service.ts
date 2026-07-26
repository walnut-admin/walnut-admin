import { Injectable, Logger } from '@nestjs/common'
import { AppDayjs } from '@walnut/utils/dayjs'
import { isNil } from 'lodash'
import { SharedBLPathService } from '@/modules/shared/BLPath/BLPath.service'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
import { calcScoreAndLevel, SecurityRiskConfigService, WalnutAdminConstRiskFactor, WalnutAdminConstRiskType } from '../risk.config.service'

@Injectable()
export class SecurityRiskRateService {
  private readonly logger = new Logger(SecurityRiskRateService.name)

  // Rate dimension weights (sum to 1.0)
  private readonly RATE_DIMENSION_WEIGHTS = {
    IP: 0.4, // IP dimension has highest weight as it's most susceptible to attacks
    DEVICE: 0.3, // Device dimension
    USER: 0.3, // User dimension
  } as const

  constructor(
    private readonly redisService: AppTechRedisService,
    private readonly configService: SecurityRiskConfigService,
    private readonly sharedIpService: SharedIpService,
    private readonly sharedBLPathService: SharedBLPathService,
  ) {}

  private get redis() {
    return this.redisService.getClient()
  }

  // ==================== Collect Methods ====================

  async collectPreAuth(path: string, ip: string, deviceId: string): Promise<void> {
    if (this.sharedBLPathService.shouldSkip(path)) {
      return
    }

    const minuteKey = this.getMinuteKey()
    const pipeline = this.redis.multi()
    const ttl = this.configService.ttl.rateBucket

    const ipKey = await this.buildKey('ip', ip, minuteKey)
    pipeline.incr(ipKey)
    pipeline.expire(ipKey, ttl)

    if (deviceId) {
      const deviceKey = await this.buildKey('device', deviceId, minuteKey)
      pipeline.incr(deviceKey)
      pipeline.expire(deviceKey, ttl)
    }

    await pipeline.exec()
  }

  async collectPostAuth(path: string, userId: string): Promise<void> {
    if (this.sharedBLPathService.shouldSkip (path)) {
      return
    }

    const minuteKey = this.getMinuteKey()
    const pipeline = this.redis.multi()
    const ttl = this.configService.ttl.rateBucket

    if (userId) {
      const userKey = await this.buildKey('user', userId, minuteKey)
      pipeline.incr(userKey)
      pipeline.expire(userKey, ttl)
    }

    await pipeline.exec()
  }

  // ==================== Evaluate Methods ====================

  /**
   * Evaluate rate limit risk
   *
   * @param ip - IP address (required)
   * @param deviceId - Device ID (optional)
   * @param userId - User ID (optional, only available in post-auth stage)
   */
  async evaluateRateRisk(
    ip: string,
    deviceId?: string,
    userId?: string,
  ): Promise<IWalnutAdminRiskEvaluationResult<IWalnutAdminRateRiskInfo>> {
    // 并行检查三个维�?
    const [ipCheckResult, deviceCheckResult, userCheckResult] = await Promise.all([
      this.checkIpRate(ip),
      !isNil(deviceId) ? this.checkDeviceRate(deviceId) : null,
      !isNil(userId) ? this.checkUserRate(userId) : null,
    ])

    // 计算加权分数
    const { score, factors } = this.calculateRateScore({
      ipCheckResult,
      deviceCheckResult,
      userCheckResult,
    })

    const { score: finalScore, level } = calcScoreAndLevel(score)

    return {
      type: WalnutAdminConstRiskType.RATE,
      score: finalScore,
      level,
      factors,
      evaluatedAt: AppDayjs().valueOf(),
      details: {
        ip,
        deviceId,
        userId,
        ipCheckResult: ipCheckResult || undefined,
        deviceCheckResult: deviceCheckResult || undefined,
        userCheckResult: userCheckResult || undefined,
      },
    }
  }

  // ==================== Private Methods ====================

  /**
   * Calculate weighted rate limit score
   *
   * Design:
   * 1. Calculate score for each dimension independently (based on excess ratio)
   * 2. Use dimension weights for weighted average
   * 3. Only exceeded dimensions participate in scoring
   */
  private calculateRateScore(params: {
    ipCheckResult: IWalnutAdminRateRiskCheckResult | null
    deviceCheckResult: IWalnutAdminRateRiskCheckResult | null
    userCheckResult: IWalnutAdminRateRiskCheckResult | null
  }): { score: number, factors: string[] } {
    const { ipCheckResult, deviceCheckResult, userCheckResult } = params

    let totalScore = 0
    let totalWeight = 0
    const factors: string[] = []

    // IP dimension
    if (ipCheckResult?.hit) {
      const ratio = ipCheckResult.current / ipCheckResult.threshold
      const dimensionScore = this.calculateDimensionScore(ratio)

      totalScore += dimensionScore * this.RATE_DIMENSION_WEIGHTS.IP
      totalWeight += this.RATE_DIMENSION_WEIGHTS.IP

      factors.push(WalnutAdminConstRiskFactor.RATE_LIMIT_EXCEEDED)

      this.logger.debug(
        `IP rate limit hit - Current: ${ipCheckResult.current}, `
        + `Threshold: ${ipCheckResult.threshold}, Ratio: ${ratio.toFixed(2)}, `
        + `Score: ${dimensionScore.toFixed(2)}`,
      )
    }

    // Device dimension
    if (deviceCheckResult?.hit) {
      const ratio = deviceCheckResult.current / deviceCheckResult.threshold
      const dimensionScore = this.calculateDimensionScore(ratio)

      totalScore += dimensionScore * this.RATE_DIMENSION_WEIGHTS.DEVICE
      totalWeight += this.RATE_DIMENSION_WEIGHTS.DEVICE

      if (!factors.includes(WalnutAdminConstRiskFactor.RATE_LIMIT_EXCEEDED)) {
        factors.push(WalnutAdminConstRiskFactor.RATE_LIMIT_EXCEEDED)
      }

      this.logger.debug(
        `Device rate limit hit - Current: ${deviceCheckResult.current}, `
        + `Threshold: ${deviceCheckResult.threshold}, Ratio: ${ratio.toFixed(2)}, `
        + `Score: ${dimensionScore.toFixed(2)}`,
      )
    }

    // User dimension
    if (userCheckResult?.hit) {
      const ratio = userCheckResult.current / userCheckResult.threshold
      const dimensionScore = this.calculateDimensionScore(ratio)

      totalScore += dimensionScore * this.RATE_DIMENSION_WEIGHTS.USER
      totalWeight += this.RATE_DIMENSION_WEIGHTS.USER

      if (!factors.includes(WalnutAdminConstRiskFactor.RATE_LIMIT_EXCEEDED)) {
        factors.push(WalnutAdminConstRiskFactor.RATE_LIMIT_EXCEEDED)
      }

      this.logger.debug(
        `User rate limit hit - Current: ${userCheckResult.current}, `
        + `Threshold: ${userCheckResult.threshold}, Ratio: ${ratio.toFixed(2)}, `
        + `Score: ${dimensionScore.toFixed(2)}`,
      )
    }

    // Calculate weighted average
    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0

    return { score: finalScore, factors: [...new Set(factors)] }
  }

  /**
   * Calculate score for a single dimension (based on excess ratio)
   *
   * Formula:
   * - ratio <= 1.0: 0 points (not exceeded)
   * - ratio = 1.5: 0.5 points (50% exceeded)
   * - ratio = 2.0: 0.7 points (100% exceeded)
   * - ratio >= 3.0: 1.0 points (200% exceeded or more)
   *
   * Uses logarithmic curve to avoid linear growth being too aggressive
   */
  private calculateDimensionScore(ratio: number): number {
    if (ratio <= 1.0) {
      return 0
    }

    // Excess ratio
    const excess = ratio - 1.0

    // Use logarithmic curve: score = min(log2(excess + 1) * 0.5, 1.0)
    // excess = 1.0 (ratio = 2.0) �?score = 0.5
    // excess = 3.0 (ratio = 4.0) �?score = 1.0
    const score = Math.min(Math.log2(excess + 1) * 0.5, 1.0)

    return score
  }

  private getMinuteKey(offsetMinute = 0): string {
    return AppDayjs()
      .subtract(offsetMinute, 'minute')
      .format('YYYYMMDDHHmm')
  }

  private async buildKey(
    type: 'ip' | 'device' | 'user',
    identifier: string,
    minuteKey: string,
  ): Promise<string> {
    const key = this.configService.redis.ratePrefix
    const normalizedIdentifier = type === 'ip'
      ? await this.sharedIpService.normalizeIp(identifier)
      : identifier
    return `${key}:${type}:${normalizedIdentifier}:${minuteKey}`
  }

  // ==================== Query Methods ====================

  async getCurrentMinuteCount(
    type: 'ip' | 'device' | 'user',
    identifier: string,
  ): Promise<number> {
    const minuteKey = this.getMinuteKey()
    const key = await this.buildKey(type, identifier, minuteKey)
    const count = await this.redis.get(key)
    return !isNil(count) ? Number(count) : 0
  }

  async getRecentMinutesCount(
    type: 'ip' | 'device' | 'user',
    identifier: string,
    minutes = 1,
  ): Promise<number> {
    if (minutes <= 0) {
      return 0
    }

    const pipeline = this.redis.multi()

    for (let offset = 0; offset < minutes; offset++) {
      const minuteKey = this.getMinuteKey(offset)
      const key = await this.buildKey(type, identifier, minuteKey)
      pipeline.get(key)
    }

    const results = await pipeline.exec()
    if (isNil(results) || results.length === 0) {
      return 0
    }

    let total = 0

    for (const item of results) {
      if (Array.isArray(item)) {
        const [, value] = item
        if (value != null) {
          total += Number(value)
        }
        continue
      }

      if (item != null) {
        total += Number(item)
      }
    }

    return total
  }

  async checkRateLimit(
    type: 'ip' | 'device' | 'user',
    identifier: string,
    windowMinutes: number,
    threshold: number,
  ): Promise<IWalnutAdminRateRiskCheckResult> {
    const current = await this.getRecentMinutesCount(type, identifier, windowMinutes)

    const hit = current >= threshold

    if (hit) {
      this.logger.warn(
        `Rate limit hit - ${type}:${identifier}, `
        + `current=${current}, threshold=${threshold}, `
        + `window=${windowMinutes}m`,
      )
    }

    const returnIdentifier
      = type === 'ip'
        ? await this.sharedIpService.normalizeIp(identifier) as string
        : identifier

    return {
      hit,
      current,
      threshold,
      windowMinutes,
      type,
      identifier: returnIdentifier,
    }
  }

  async checkIpRate(ip: string): Promise<IWalnutAdminRateRiskCheckResult | null> {
    const oneMinute = await this.checkRateLimit(
      'ip',
      ip,
      1,
      this.configService.thresholds.rate.ip1m,
    )
    if (oneMinute.hit) {
      return oneMinute
    }

    const fiveMinute = await this.checkRateLimit(
      'ip',
      ip,
      5,
      this.configService.thresholds.rate.ip5m,
    )
    if (fiveMinute.hit) {
      return fiveMinute
    }

    return null
  }

  async checkDeviceRate(deviceId: string): Promise<IWalnutAdminRateRiskCheckResult | null> {
    const result = await this.checkRateLimit(
      'device',
      deviceId,
      1,
      this.configService.thresholds.rate.device1m,
    )
    return result.hit ? result : null
  }

  async checkUserRate(userId: string): Promise<IWalnutAdminRateRiskCheckResult | null> {
    const result = await this.checkRateLimit(
      'user',
      userId,
      1,
      this.configService.thresholds.rate.user1m,
    )
    return result.hit ? result : null
  }
}

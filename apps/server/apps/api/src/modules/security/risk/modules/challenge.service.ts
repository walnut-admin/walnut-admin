import { Injectable, Logger } from '@nestjs/common'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { isNil } from 'lodash'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
import { SecurityRiskConfigService } from '../risk.config.service'

export interface ChallengeParams {
  ip: string
  deviceId: string
  userId?: string
  location?: string
}

/**
 * Manages the state of risk challenges (verification).
 * Handles marking, checking, and clearing challenges based on risk factors.
 */
@Injectable()
export class SecurityRiskChallengeStateService {
  private readonly logger = new Logger(SecurityRiskChallengeStateService.name)

  // Config: Maps Factor Prefix -> Scope & Required Params
  // This replaces all if/switch logic with a declarative approach.
  private readonly FACTOR_RULES = [
    { prefix: 'USER_DEVICE_', scope: 'user-device', keys: ['userId', 'deviceId'] },
    { prefix: 'DEVICE_', scope: 'device', keys: ['deviceId'] },
    { prefix: 'USER_', scope: 'user', keys: ['userId'] },
    { prefix: 'IP_', scope: 'ip', keys: ['ip'] },
    { prefix: 'LOCATION_', scope: 'location', keys: ['location'] },
  ]

  constructor(
    private readonly redisService: AppTechRedisService,
    private readonly configService: SecurityRiskConfigService,
  ) {}

  private get redis() {
    return this.redisService.getClient()
  }

  /**
   * Mark a factor as handled/verified.
   */
  async markChallengeHandled(factor: string, params: ChallengeParams): Promise<void> {
    if (!this.configService.isCritical(factor))
      return

    const key = this.getChallengeKey(factor, params)

    if (key === null) {
      this.logger.warn(`Cannot build key for factor: ${factor}`)
      return
    }

    const ttl = this.configService.ttl.challenge
    // Minimal payload for storage
    await this.redis.setEx(key, ttl, JSON.stringify({
      factor,
      handledAt: AppDayjs().valueOf(),
    }))

    this.logger.log(`Challenge handled - Factor: ${factor}`)
  }

  /**
   * Check if a factor's challenge is already handled.
   */
  async isChallengeHandled(factor: string, params: ChallengeParams): Promise<boolean> {
    if (!this.configService.isCritical(factor))
      return true
    const key = this.getChallengeKey(factor, params)
    if (key === null) {
      this.logger.warn(`Cannot build key for factor: ${factor}`)
      return false
    }
    return await this.redis.exists(key) === 1
  }

  /**
   * Batch check challenge status for multiple factors.
   */
  async batchCheckChallenges(factors: string[], params: ChallengeParams): Promise<Map<string, boolean>> {
    if (factors.length === 0)
      return new Map()

    const results = await Promise.all(
      factors.map(async f => [f, await this.isChallengeHandled(f, params)] as const),
    )
    return new Map(results)
  }

  /**
   * Clear all challenge marks for specific dimensions.
   */
  async clearChallenges(params: ChallengeParams): Promise<void> {
    const prefix = this.configService.redis.challenge
    const patterns: string[] = []

    // Helper to build pattern based on key position
    const addPatterns = (scope: string, keys: (keyof ChallengeParams)[]) => {
      const values = keys.map(k => params[k]).filter(Boolean)
      if (values.length === 0)
        return

      // Construct pattern: prefix:scope:val1:val2:*
      // We need to handle the dynamic position of values.
      // Simplified: Iterate combinations to ensure we catch the key.
      // e.g. for user-device (uid, did): `prefix:user-device:uid:*` AND `prefix:user-device:*:did`

      if (values.length === 1) {
        patterns.push(`${prefix}:${scope}:${values[0]}:*`)
      }
      else if (values.length > 1) {
        // For multi-key scenarios (user-device), create patterns for each key position
        keys.forEach((key) => {
          const val = params[key]
          if (isNil(val))
            return

          const placeholders = keys.map(k => k === key ? val : '*')
          patterns.push(`${prefix}:${scope}:${placeholders.join(':')}:*`)
        })
      }
    }

    // Iterate rules to generate patterns based on provided params
    this.FACTOR_RULES.forEach((rule) => {
      addPatterns(rule.scope, rule.keys as (keyof ChallengeParams)[])
    })

    if (patterns.length > 0) {
      await Promise.all(patterns.map(async p => this.redisService.delByPattern(p)))
      this.logger.log(`Challenges cleared`)
    }
  }

  // ==================== Helpers ====================

  /**
   * Build Redis key using configuration rules (declarative approach, no conditionals).
   */
  private getChallengeKey(factor: string, params: ChallengeParams): string | null {
    const prefix = this.configService.redis.challenge

    // Find matching rule
    const rule = this.FACTOR_RULES.find(r => factor.startsWith(r.prefix))

    if (!rule)
      return null

    // Fallback: Use device scope if no rule matches
    const scope = rule.scope || 'device'
    const keys = rule.keys.length > 0 ? rule.keys : ['deviceId']

    // Extract values
    const values = keys.map(k => params[k as keyof ChallengeParams])
    if (values.some(v => isNil(v)))
      return null // Missing required param

    return `${prefix}:${scope}:${values.join(':')}:${factor}`
  }
}

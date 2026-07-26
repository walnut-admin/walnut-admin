import { Injectable, Logger } from '@nestjs/common'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { isNil } from 'lodash'
import { ChallengeParams, SecurityRiskChallengeStateService } from './modules/challenge.service'
import { SecurityRiskDeviceService } from './modules/device.service'
import { SecurityRiskFailedLoginService } from './modules/failedLogin.service'
import { SecurityRiskIPService } from './modules/ip.service'
import { SecurityRiskLocationService } from './modules/location.service'
import { SecurityRiskRateService } from './modules/rate.service'
import { SecurityRiskUserService } from './modules/user.service'
import { SecurityRiskUserDeviceService } from './modules/user_device.service'
import {
  getRiskLevel,
  SecurityRiskConfigService,
  WalnutAdminConstRiskLevel,
  WalnutAdminConstRiskType,
} from './risk.config.service'

/**
 * Core Risk Assessment Service
 * Orchestrates pre-auth, post-auth, and comprehensive risk evaluations.
 */
@Injectable()
export class SecurityRiskService {
  private readonly logger = new Logger(SecurityRiskService.name)

  // Mapping of internal keys to config weight keys
  private readonly WEIGHT_KEY_MAP: Record<string, 'IP' | 'DEVICE' | 'FAILED_LOGIN' | 'LOCATION' | 'RATE' | 'USER' | 'USER_DEVICE'> = {
    ip: 'IP',
    device: 'DEVICE',
    failedLogin: 'FAILED_LOGIN',
    location: 'LOCATION',
    rate: 'RATE',
    user: 'USER',
    userDevice: 'USER_DEVICE',
  }

  constructor(
    private readonly configService: SecurityRiskConfigService,
    private readonly ipService: SecurityRiskIPService,
    private readonly deviceService: SecurityRiskDeviceService,
    private readonly failedLoginService: SecurityRiskFailedLoginService,
    private readonly locationService: SecurityRiskLocationService,
    private readonly rateService: SecurityRiskRateService,
    private readonly userService: SecurityRiskUserService,
    private readonly userDeviceService: SecurityRiskUserDeviceService,
    private readonly challengeStateService: SecurityRiskChallengeStateService,
  ) {}

  // ==================== Evaluation Methods ====================

  async evaluatePreAuth(params: { ip: string, deviceId: string, identifier?: string }): Promise<IWalnutAdminPreAuthRiskResult> {
    const { ip, deviceId, identifier } = params

    const [ipResult, deviceResult, failedLoginResult, locationResult, rateResult] = await Promise.all([
      this.ipService.evaluateIP(ip),
      this.deviceService.evaluateDevice(deviceId),
      this.failedLoginService.evaluateFailedLogin(deviceId, identifier),
      this.locationService.evaluateLocationRisk(ip),
      this.rateService.evaluateRateRisk(ip, deviceId),
    ])

    const score = this.calculateWeightedScore({
      ip: ipResult,
      device: deviceResult,
      failedLogin: failedLoginResult,
      location: locationResult,
      rate: rateResult,
    })

    this.logger.debug(`Pre-Auth Score: ${score.toFixed(2)}`)

    return {
      type: WalnutAdminConstRiskType.BEFORE_AUTH,
      ip: ipResult,
      device: deviceResult,
      location: locationResult,
      rate: rateResult,
      failedLogin: failedLoginResult,
      score,
      level: getRiskLevel(score),
    }
  }

  async evaluatePostAuth(params: { userId: string, deviceId: string, ip: string }): Promise<IWalnutAdminPostAuthRiskResult> {
    const { userId, deviceId } = params

    const [userResult, userDeviceResult] = await Promise.all([
      this.userService.evaluateUser(userId),
      this.userDeviceService.evaluateUserDevice(userId, deviceId),
    ])

    const score = this.calculateWeightedScore({ user: userResult, userDevice: userDeviceResult })

    this.logger.debug(`Post-Auth Score: ${score.toFixed(2)}`)

    return {
      type: WalnutAdminConstRiskType.AFTER_AUTH,
      user: userResult,
      userDevice: userDeviceResult,
      score,
      level: getRiskLevel(score),
    }
  }

  async evaluateComprehensivePreAuth(params: {
    ip: string
    deviceId: string
    identifier?: string
  }): Promise<IWalnutAdminComprehensiveRiskResult> {
    const preAuth = await this.evaluatePreAuth(params)

    // Flatten factors
    const allFactors = [
      preAuth.ip,
      preAuth.device,
      preAuth.failedLogin,
      preAuth.location,
      preAuth.rate,
    ].flatMap(r => r.factors)

    const score = Number(preAuth.score.toFixed(2))
    const level = getRiskLevel(score)

    const result: IWalnutAdminComprehensiveRiskResult = {
      type: WalnutAdminConstRiskType.COMPREHENSIVE,
      preAuth,
      overallScore: score,
      overallLevel: level,
      allFactors: [...new Set(allFactors)],
      recommendation: await this.generateRecommendation({
        score,
        level,
        stage: 'pre-auth',
        preAuth,
        challengeParams: { ip: params.ip, deviceId: params.deviceId },
      }),
      evaluatedAt: AppDayjs().valueOf(),
    }

    this.logHighRisk(level, score, allFactors, 'Pre-Auth')
    return result
  }

  async evaluateComprehensivePostAuth(params: {
    userId: string
    deviceId: string
    ip: string
    preAuth: IWalnutAdminPreAuthRiskResult
  }): Promise<IWalnutAdminComprehensiveRiskResult> {
    const { userId, deviceId, ip, preAuth } = params
    const postAuth = await this.evaluatePostAuth({ userId, deviceId, ip })

    const allFactors = [
      ...[preAuth.ip, preAuth.device, preAuth.failedLogin, preAuth.location, preAuth.rate].flatMap(r => r.factors),
      ...[postAuth.user, postAuth.userDevice].flatMap(r => r.factors),
    ]

    // 50/50 Weighting
    const score = Number(((preAuth.score + postAuth.score) / 2).toFixed(2))
    const level = getRiskLevel(score)

    const result: IWalnutAdminComprehensiveRiskResult = {
      type: WalnutAdminConstRiskType.COMPREHENSIVE,
      preAuth,
      postAuth,
      overallScore: score,
      overallLevel: level,
      allFactors: [...new Set(allFactors)],
      recommendation: await this.generateRecommendation({
        score,
        level,
        stage: 'post-auth',
        preAuth,
        postAuth,
        challengeParams: { ip, deviceId, userId },
      }),
      evaluatedAt: AppDayjs().valueOf(),
    }

    this.logHighRisk(level, score, allFactors, 'Post-Auth')
    return result
  }

  // ==================== Score Calculation ====================

  private calculateWeightedScore(results: Record<string, IWalnutAdminRiskEvaluationResult<any>>): number {
    const weights = this.configService.moduleWeights
    let totalScore = 0
    let totalWeight = 0

    for (const [key, result] of Object.entries(results)) {
      if (isNil(result))
        continue

      const weightKey = this.WEIGHT_KEY_MAP[key]
      const weight = weightKey ? weights[weightKey] : 0

      totalScore += result.score * weight
      totalWeight += weight
    }

    return totalWeight > 0 ? Math.min(totalScore / totalWeight, 1.0) : 0
  }

  private async generateRecommendation(params: {
    score: number
    level: IWalnutAdminConstRiskLevel
    stage: 'pre-auth' | 'post-auth'
    preAuth: IWalnutAdminPreAuthRiskResult
    postAuth?: IWalnutAdminPostAuthRiskResult
    challengeParams: ChallengeParams
  }): Promise<IWalnutAdminComprehensiveRiskResult['recommendation']> {
    const { level, stage, preAuth, postAuth, challengeParams } = params

    // 1. Check unhandled critical factors that require verification
    const unhandledCritical = await this.getUnhandledCriticalFactors(stage, preAuth, postAuth, challengeParams)

    if (unhandledCritical.length > 0) {
      this.logger.warn(`Unhandled critical factors: [${unhandledCritical.join(', ')}]`)
      return {
        shouldBlock: false,
        shouldChallenge: true,
        shouldLog: true,
        reason: 'CRITICAL_FACTORS_REQUIRE_VERIFICATION',
        criticalFactors: unhandledCritical,
      }
    }

    // 2. Check risk level and return appropriate recommendation
    if (level === WalnutAdminConstRiskLevel.CRITICAL || level === WalnutAdminConstRiskLevel.HIGH) {
      return { shouldBlock: false, shouldChallenge: true, shouldLog: true, reason: `HIGH_RISK(${params.score})` }
    }

    if (level === WalnutAdminConstRiskLevel.MEDIUM) {
      return { shouldBlock: false, shouldChallenge: false, shouldLog: true, reason: `MEDIUM_RISK(${params.score})` }
    }

    return { shouldBlock: false, shouldChallenge: false, shouldLog: false, reason: 'LOW_RISK' }
  }

  private async getUnhandledCriticalFactors(
    stage: 'pre-auth' | 'post-auth',
    preAuth: IWalnutAdminPreAuthRiskResult,
    postAuth: IWalnutAdminPostAuthRiskResult | undefined,
    params: ChallengeParams,
  ): Promise<string[]> {
    const config = stage === 'pre-auth'
      ? this.configService.getPreAuthCriticalFactors()
      : this.configService.getPostAuthCriticalFactors()

    // Collect factors based on authentication stage
    let factors: string[] = []
    if (stage === 'pre-auth') {
      factors = [...preAuth.device.factors, ...preAuth.location.factors]
    }
    else if (postAuth) {
      if (isNil(params.userId))
        return [] // Skip if no user context
      factors = [...postAuth.userDevice.factors]
    }

    const criticalFactors = factors.filter(f => config.has(f))
    if (criticalFactors.length === 0)
      return []

    const statusMap = await this.challengeStateService.batchCheckChallenges(criticalFactors, params)
    return criticalFactors.filter(f => !statusMap.get(f))
  }

  private logHighRisk(level: string, score: number, factors: string[], context: string): void {
    if (level === WalnutAdminConstRiskLevel.HIGH || level === WalnutAdminConstRiskLevel.CRITICAL) {
      this.logger.warn(`High Risk [${context}] Score: ${score}, Factors: ${factors.slice(0, 5).join(', ')}`)
    }
  }

  async clearPostAuthRiskResult(params: ChallengeParams): Promise<void> {
    const { userId, deviceId } = params
    await Promise.all([
      this.userService.clearUserCache(userId!),
      this.userDeviceService.clearUserDeviceCache(userId!, deviceId),
      this.challengeStateService.clearChallenges(params),
    ])
    this.logger.debug(`Post-Auth cache cleared - UserId: ${userId}, DeviceId: ${deviceId}`)
  }
}

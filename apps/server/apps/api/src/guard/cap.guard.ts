import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstAppCacheKeys } from '@walnut/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'
import {
  WalnutAdminExceptionCapInteractionRequired,
  WalnutAdminExceptionCapRefreshRequired,
  WalnutAdminExceptionYouAreBot,
} from '@walnut/exceptions/business/auth'
import { isNil } from 'lodash'
import { MurLockService } from 'murlock'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { AppCapJS } from '@/modules/security/cap/cap.service'
import { SecurityRiskChallengeStateService } from '@/modules/security/risk/modules/challenge.service'
import { AppTechCacheCapService } from '@/modules/techniques/cache/service/cache.cap'

const WalnutAdminConstDecoratorCapFreeKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_CAP_FREE')

/**
 * 装饰器：跳过 CAP 验证
 */
export function WalnutAdminGuardCapFree() {
  return SetMetadata(WalnutAdminConstDecoratorCapFreeKey, true)
}

/**
 * CAP Guard - Human verification execution�?
 *
 * 1. Read Risk Guard output�?recommendation
 * 2. If shouldChallenge=true, execute human verification�?
 * 3. Supports three error semantics�?
 *    - 40116 Interaction Required：Requires explicit user interaction (new device, high risk)�?
 *    - 40117 Refresh Required：Silent refresh (Token expired)�?
 *    - 40111 Invalid：Directly judged as invalid
 * 4. After successful verification, mark critical factors as processed
 *
 * Design approach�?
 * - 同一�?CAP Guard class，在认证前后各执行一�?
 * - Pre-auth and post-auth validation logic are identical�?
 * - 不关心是否已认证，只�?recommendation 并执�?
 */
@Injectable()
export class WalnutAdminGuardCap implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardCap.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly murLockService: MurLockService,
    private readonly cacheCapService: AppTechCacheCapService,
    private readonly challengeStateService: SecurityRiskChallengeStateService,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    // ============================================================
    // Step 1: 检查是否跳�?CAP 验证
    // ============================================================

    if (request.isPostman) {
      this.logger.debug('Skipping CAP for Postman Runtime request')
      return true
    }

    const capFree = this.reflector.getAllAndOverride<boolean>(
      WalnutAdminConstDecoratorCapFreeKey,
      [context.getHandler(), context.getClass()],
    )

    if (capFree) {
      this.logger.debug('Skipping CAP for endpoint')
      return true
    }

    // ============================================================
    // Step 2: Read Risk Guard risk decision�?
    // ============================================================

    const recommendation = request.risk?.comprehensive?.recommendation

    if (recommendation === undefined) {
      this.logger.warn('No risk evaluation found, allowing request')
      return true
    }

    // ============================================================
    // Step 3: CAP token 硬校验（⚠️ 必须先于 shouldChallenge�?
    // ============================================================

    const capToken = getWalnutAdminCookie(
      request,
      WalnutAdminConstCookieKeys.CAPJS_TOKEN,
    )

    // --- Token 缺失 ---
    if (isNil(capToken)) {
      this.logger.warn(
        `CAP token missing, shouldChallenge=${recommendation.shouldChallenge}`,
      )

      // 即使当前策略不要�?challenge，也不能视为已验�?
      if (recommendation.shouldChallenge) {
        throw new WalnutAdminExceptionCapInteractionRequired() // 40116
      }

      // 策略降级场景：允许无感刷新，但不能直接放�?
      throw new WalnutAdminExceptionCapRefreshRequired() // 40117
    }

    const deviceId = getWalnutAdminCookie(
      request,
      WalnutAdminConstCookieKeys.DEVICE_ID,
    )

    // --- Token 存在，校验有效�?---
    const isValid = await this.validateCapToken(capToken, deviceId)

    if (!isValid) {
      this.logger.warn(
        `Invalid CAP token, shouldChallenge=${recommendation.shouldChallenge}`,
      )

      if (recommendation.shouldChallenge) {
        throw new WalnutAdminExceptionCapInteractionRequired() // 40116
      }

      throw new WalnutAdminExceptionCapRefreshRequired() // 40117
    }

    // --- Token 有效，标�?critical factors 为已处理 ---
    await this.markCriticalFactorsAsHandled(request, deviceId)

    // ============================================================
    // Step 4: Token 合法后，return true
    // ============================================================

    // Token 有效且无需额外验证，通过
    this.logger.debug(
      `CAP verification passed - Token: ${capToken}`,
    )

    return true
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * 验证 CAP Token（带缓存+分布式锁+Double-check�?
   */
  private async validateCapToken(capToken: string, deviceId: string): Promise<boolean> {
    // 1. 快速路径：检查缓�?
    const cachedResult = await this.cacheCapService.getCapTokenCache(deviceId)

    if (cachedResult !== null) {
      this.logger.debug(`CAP token cache hit: ${capToken}`)
      return cachedResult
    }

    // 2. 缓存未命中，使用分布式锁防止并发
    return this.verifyCapTokenWithLock(capToken, deviceId)
  }

  /**
   * 使用分布式锁验证 CAP Token
   */
  private async verifyCapTokenWithLock(capToken: string, deviceId: string): Promise<boolean> {
    const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:CAP:${deviceId}`

    try {
      return await this.murLockService.runWithLock(
        lockKey,
        3000, // 3s 锁超?
        async () => {
          // Double-check 缓存
          const cachedResult = await this.cacheCapService.getCapTokenCache(deviceId)

          if (cachedResult !== null) {
            this.logger.debug(`CAP token double-check cache hit: ${deviceId}`)
            return cachedResult
          }

          // 执行真正的验�?
          return this.performCapVerification(capToken, deviceId)
        },
      )
    }
    catch (error: any) {
      this.logger.error(`CAP verification error: ${error}`)
      throw error
    }
  }

  /**
   * 执行实际�?CAP 验证（调用第三方 API�?
   */
  private async performCapVerification(capToken: string, deviceId: string): Promise<boolean> {
    this.logger.log(`Starting CAP verification: ${deviceId}`)

    try {
      const { success } = await AppCapJS.validateToken(capToken)

      if (!success) {
        this.logger.warn(`CAP verification failed: ${deviceId}`)
        throw new WalnutAdminExceptionYouAreBot()
      }

      // 缓存验证结果
      await this.cacheCapService.setCapTokenCache(deviceId)

      this.logger.log(`CAP verification successful: ${deviceId}`)
      return true
    }
    catch (error: any) {
      this.logger.error(`CAP API call failed: ${error}`)
      return false
    }
  }

  /**
   * 标记当前Request中的 critical factors 已通过验证（修正版�?
   *
   * 关键修正�?
   * 1. 使用新的 markChallengeHandled API
   * 2. 自动区分设备级和用户-设备级因�?
   * 3. Pre Auth 因子只需�?deviceId
   * 4. Post Auth 因子需�?userId + deviceId
   */
  private async markCriticalFactorsAsHandled(
    request: IWalnutAdminExpressRequest,
    deviceId: string,
  ): Promise<void> {
    const recommendation = request.risk?.comprehensive?.recommendation
    const criticalFactors = recommendation?.criticalFactors

    if (!criticalFactors || criticalFactors.length === 0) {
      this.logger.debug('No critical factors to mark')
      return
    }

    // 获取 userId（可能为 undefined�?
    const userId = request.user?.userId as string

    // ============ 批量标记所�?critical factors ============

    // 使用新的通用 API，会自动判断因子类型
    const promises = criticalFactors.map(async factor =>
      this.challengeStateService.markChallengeHandled(
        factor,
        { deviceId, userId, ip: request.realIp }, // Pre Auth 时为 undefined，Post Auth 时有?
      ),
    )

    await Promise.all(promises)

    this.logger.log(
      `Marked ${criticalFactors.length} critical factors as handled after CAP verification - `
      + `Device: ${deviceId}, User: ${userId || 'N/A'}, `
      + `Factors: [${criticalFactors.join(', ')}]`,
    )
  }
}

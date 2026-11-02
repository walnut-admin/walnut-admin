import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AppTechCacheCapService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { getWalnutAdminCookie } from '@walnut-server/cookie'
import {
  WalnutAdminExceptionCapInteractionRequired,
  WalnutAdminExceptionCapRefreshRequired,
  WalnutAdminExceptionYouAreBot,
} from '@walnut-server/exceptions/business/auth'
import { AppCapJS } from '@walnut-server/security/cap/cap.service'
import { SecurityRiskChallengeStateService } from '@walnut-server/security/risk/modules/challenge.service'
import { isNil } from 'lodash'
import { MurLockService } from 'murlock'

const WalnutAdminConstDecoratorCapFreeKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_CAP_FREE')

/**
 * 装饰器：跳过 CAP 验证
 */
export function WalnutAdminGuardCapFree() {
  return SetMetadata(WalnutAdminConstDecoratorCapFreeKey, true)
}

/**
 * CAP Guard —— 人机验证执行入口
 *
 * 1. 读取 Risk Guard 的输出 recommendation
 * 2. 当 shouldChallenge=true 时，执行人机验证
 * 3. 支持三种错误语义：
 *    - 40116 Interaction Required：需要用户显式交互（新设备、高风险）
 *    - 40117 Refresh Required：静默刷新（Token 过期）
 *    - 40111 Invalid：Directly judged as invalid
 * 4. After successful verification, mark critical factors as processed
 *
 * 设计思路：
 * - 同一个 CAP Guard 类，在认证前后各执行一次
 * - Pre-auth 与 post-auth 的校验逻辑完全一致
 * - 不关心是否已认证，只读取 recommendation 并执行
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
    // Step 1: 检查是否跳过 CAP 验证
    // ============================================================

    // F-44：噪声过滤，**不是安全边界** —— isPostman 已被 isDev 门住（生产恒 false），权威说明见 apps/api/src/middleware/src/user-agent.middleware.ts 的 isPostmanRuntimeRequest。
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
    // Step 2: 读取 Risk Guard 的风险决策
    // ============================================================

    const recommendation = request.risk?.comprehensive?.recommendation

    if (recommendation === undefined) {
      this.logger.warn('No risk evaluation found, allowing request')
      return true
    }

    // ============================================================
    // Step 3: CAP token 硬校验（必须先于 shouldChallenge）
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

      // 即使当前策略不要求 challenge，也不能视为已验证
      if (recommendation.shouldChallenge) {
        throw new WalnutAdminExceptionCapInteractionRequired() // 40116
      }

      // 策略降级场景：允许无感刷新，但不能直接放行
      throw new WalnutAdminExceptionCapRefreshRequired() // 40117
    }

    const deviceId = getWalnutAdminCookie(
      request,
      WalnutAdminConstCookieKeys.DEVICE_ID,
    )

    // --- Token 存在，校验有效性 ---
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

    // --- Token 有效，标记 critical factors 为已处理 ---
    await this.markCriticalFactorsAsHandled(request, deviceId)

    // ============================================================
    // Step 4: Token 合法后，return true
    // ============================================================

    // Token 有效且无需额外验证，通过
    // F-06：capToken 是客户端凭据（可重放），不得入日志；deviceId 在本文其余 debug
    // 日志里已经是定位口径，口径不变。
    this.logger.debug(`CAP verification passed - device: ${deviceId}`)

    return true
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * 验证 CAP Token（带缓存 + 分布式锁 + Double-check）
   */
  private async validateCapToken(capToken: string, deviceId: string): Promise<boolean> {
    // 1. 快速路径：检查缓存（缓存键 = deviceId + token 指纹，跨设备移植的 token 不命中）
    const cachedResult = await this.cacheCapService.getCapTokenCache(deviceId, capToken)

    if (cachedResult !== null) {
      this.logger.debug(`CAP token cache hit: ${deviceId}`)
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
        3000, // 3s 锁超时
        async () => {
          // Double-check 缓存
          const cachedResult = await this.cacheCapService.getCapTokenCache(deviceId, capToken)

          if (cachedResult !== null) {
            this.logger.debug(`CAP token double-check cache hit: ${deviceId}`)
            return cachedResult
          }

          // 执行真正的验证
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
   * 执行实际的 CAP 验证（调用第三方 API）
   */
  private async performCapVerification(capToken: string, deviceId: string): Promise<boolean> {
    this.logger.log(`Starting CAP verification: ${deviceId}`)

    try {
      const { success } = await AppCapJS.validateToken(capToken)

      if (!success) {
        this.logger.warn(`CAP verification failed: ${deviceId}`)
        throw new WalnutAdminExceptionYouAreBot()
      }

      // 缓存验证结果（键绑定本轮通过校验的 token 指纹）
      await this.cacheCapService.setCapTokenCache(deviceId, capToken)

      this.logger.log(`CAP verification successful: ${deviceId}`)
      return true
    }
    catch (error: any) {
      this.logger.error(`CAP API call failed: ${error}`)
      return false
    }
  }

  /**
   * 标记当前 Request 中的 critical factors 已通过验证（修正版）
   *
   * 关键修正：
   * 1. 使用新的 markChallengeHandled API
   * 2. 自动区分设备级和用户-设备级因子
   * 3. Pre Auth 因子只需要 deviceId
   * 4. Post Auth 因子需要 userId + deviceId
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

    // 获取 userId（可能为 undefined）
    const userId = request.user?.userId as string

    // ============ 批量标记所有 critical factors ============

    // 使用新的通用 API，会自动判断因子类型
    const promises = criticalFactors.map(async factor =>
      this.challengeStateService.markChallengeHandled(
        factor,
        { deviceId, userId, ip: request.realIp }, // Pre Auth 时为 undefined，Post Auth 时有值
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

import type { WalnutLockService } from '@walnut-server/lock'
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AppTechCacheCapService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { getWalnutAdminCookie, getWalnutAdminCookieString } from '@walnut-server/cookie'
import { WalnutAdminExceptionRiskUnavailable } from '@walnut-server/exceptions/base/406'
import {
  WalnutAdminExceptionCapInteractionRequired,
  WalnutAdminExceptionCapRefreshRequired,
  WalnutAdminExceptionYouAreBot,
} from '@walnut-server/exceptions/business/auth'
import { WALNUT_ADMIN_LOCK } from '@walnut-server/lock'
import { AppCapJS } from '@walnut-server/security/cap/cap.service'
import { SecurityRiskChallengeStateService } from '@walnut-server/security/risk/modules/challenge.service'
import { isNil } from 'lodash'

import { isWellFormedCapJsToken, WalnutAdminConstDecoratorCapFreeKey } from './cap.decorator'
import { isWalnutAdminRiskFailClose, walnutAdminRiskRouteKey } from './risk.sensitivity'

/**
 * CAP Guard —— 人机验证执行入口
 *
 * 1. 读取 Risk Guard 的输出 recommendation
 * 2. 当 shouldChallenge=true 时，执行人机验证
 * 3. 三种错误语义（**三条都真实可达**，review CAP-6 修掉了 40111 的死码）：
 *    - 40111 Bot Verify Failed：cookie 里的值**不是一枚 cap.js token**（伪造 / 损坏 / 被改写）。
 *      这是本 guard 唯一能在本地证实的"客户端不可信"信号，重放同一枚坏 cookie 不会自愈。
 *    - 40116 Interaction Required：需要用户显式交互（新设备、高风险），或凭据缺失 + 策略要求挑战
 *    - 40117 Refresh Required：凭据缺失/已被 cap.js 判过期（一次性 token 已消费）——
 *      交给客户端无感刷新后重放
 * 4. After successful verification, mark critical factors as processed
 * 5. Risk guard 没留下 decision 时**按端点分级**（批次 8 / B2）：敏感端点 40667 fail-close，
 *    其余 fail-open + `request.riskDegraded` 留痕（旧实现无条件放行，正是守卫链的第三个缺口）
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
    @Inject(WALNUT_ADMIN_LOCK) private readonly lockService: WalnutLockService,
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

    // 批次 8 / B2（守卫链第三腿）：Risk guard 因故没留下 decision 时，旧实现无条件放行 ——
    // 它与 risk.guard 的两处 `return true` 叠加成「风控一挂 ⇒ 机器人防护完全不执行」。
    // 现在与 risk.guard 同口径分级：**敏感端点 fail-close**（40667），其余 fail-open + 留痕。
    // 纵深意义：即使将来有人把 Risk guard 从 APP_GUARD 里挪走 / 调换顺序，凭据面仍然不会裸奔。
    if (recommendation === undefined) {
      if (isWalnutAdminRiskFailClose(request.method, request.path)) {
        const routeKey = walnutAdminRiskRouteKey(request.method, request.path)
        this.logger.error(`No risk decision on fail-close endpoint (${routeKey}), rejecting`)
        throw new WalnutAdminExceptionRiskUnavailable(`risk-recommendation-missing @ ${routeKey}`)
      }

      // 不覆盖 risk.guard 已经写下的更具体原因（no-device-id / risk-evaluation-failed）——
      // 这里的 'risk-recommendation-missing' 只在「risk guard 根本没跑过」时才该出现
      request.riskDegraded ??= 'risk-recommendation-missing'
      this.logger.warn('No risk evaluation found, allowing request (meta.riskDegraded set)')
      return true
    }

    // ============================================================
    // Step 3: CAP token 硬校验（必须先于 shouldChallenge）
    // ============================================================

    // review CAP-4：`cookie-parser` 对「带 s: 前缀但签名错」的值返回 **false**（不是 undefined），
    // 所以「存在性」必须按**可用字符串**判，不能只判 isNil —— 否则 false 会一路走到
    // `createHash().update(false)` 抛 ERR_INVALID_ARG_TYPE，变成 HTTP 200 + body.code 50000。
    const capToken = getWalnutAdminCookieString(
      request,
      WalnutAdminConstCookieKeys.CAPJS_TOKEN,
    )

    // --- Token 缺失（含签名错 / 空串的畸形 cookie）---
    if (isNil(capToken)) {
      this.logger.warn(
        `CAP token missing or malformed, shouldChallenge=${recommendation.shouldChallenge}`,
      )

      // 即使当前策略不要求 challenge，也不能视为已验证
      if (recommendation.shouldChallenge) {
        throw new WalnutAdminExceptionCapInteractionRequired() // 40116
      }

      // 策略降级场景：允许无感刷新，但不能直接放行
      throw new WalnutAdminExceptionCapRefreshRequired() // 40117
    }

    // deviceId 沿用旧读取器（返回 false 时只会退化成缓存键里的 "false"，不参与哈希）；
    // 判空退化登记为 P3 / CAP-9，本轮 P1 不改
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
      return await this.lockService.runWithLock(
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

    // ---- 40111 出口（review CAP-6 / P3-31）----
    // 旧写法把 `throw new WalnutAdminExceptionYouAreBot()` 放在 try 里，被自己的 catch
    // 吞成 `return false` ⇒ 客户端永远只能看到 40116/40117，40111 与前端分支全是死码。
    //
    // 现在按「**谁能证明什么**」切开，而不是把三种语义糊成一个 false：
    // - 值不是 cap.js token 的形态（`<id>:<vertoken>`，两段 hex）⇒ 本地即可判定客户端在
    //   交伪造/损坏凭据 ⇒ 40111。注意这里**不是**"token 过期"：过期/已消费只表现为
    //   `validateToken → success:false`，那属于可自愈路径，仍是 40116/40117。
    // - validateToken **抛异常**（.data 文件存储坏 / 只读 FS / 磁盘满）⇒ 设施故障，
    //   不能冤枉用户是机器人 ⇒ 返回 false 走 40116/40117。
    // - success:false ⇒ 凭据已被 cap.js 消费或过期 ⇒ 返回 false 走 40116/40117 自愈。
    //
    // 为什么 success:false 不直接抛 40111（review CAP-6 option (a) 的做法）：cap.js 对
    // "一次性 token 已被消费" 与 "判定为机器人" 返回的是**同一个** `{ success: false }`
    // （@cap.js/server 4.0.5 index.js:409-437），而缓存窗口只有 20 分钟 ⇒ 每个正常用户
    // 20 分钟后第一次请求都会命中这条分支。若抛 40111，前端会跳 /not-allowed，等于
    // 每 20 分钟踢一次全部用户。详见 reports/review-cap/fix-p1.md「需要 Lead 拍板」。
    if (!isWellFormedCapJsToken(capToken)) {
      this.logger.warn(`CAP token is not a cap.js token (malformed/forged): ${deviceId}`)
      throw new WalnutAdminExceptionYouAreBot()
    }

    let success: boolean

    try {
      ({ success } = await AppCapJS.validateToken(capToken))
    }
    catch (error: any) {
      this.logger.error(`CAP API call failed: ${error}`)
      return false
    }

    if (!success) {
      this.logger.warn(`CAP verification failed: ${deviceId}`)
      return false
    }

    // 缓存验证结果（键绑定本轮通过校验的 token 指纹）
    await this.cacheCapService.setCapTokenCache(deviceId, capToken)

    this.logger.log(`CAP verification successful: ${deviceId}`)
    return true
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

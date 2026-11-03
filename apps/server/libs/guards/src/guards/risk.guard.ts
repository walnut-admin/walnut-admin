import type { WalnutAdminRiskDegradedReason } from './risk.sensitivity'
import { CanActivate, ExecutionContext, HttpException, Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { getWalnutAdminCookie } from '@walnut-server/cookie'
import { WalnutAdminExceptionRiskUnavailable } from '@walnut-server/exceptions/base/406'
import { SecurityRiskRateService } from '@walnut-server/security/risk/modules/rate.service'
import { SecurityRiskService } from '@walnut-server/security/risk/risk.service'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { fireAndForget } from '@walnut-server/utils/fire-and-forget'
import { Recordable } from 'easy-fns-ts'
import { isNil } from 'lodash'
import { isWalnutAdminRiskFailClose, resolveWalnutAdminRiskSensitivity, walnutAdminRiskRouteKey } from './risk.sensitivity'

/**
 * Risk Guard - Risk assessment (supports both pre and post authentication)
 *
 * Responsibilities (assessment only, no blocking):
 * 1. Pre-auth: Evaluate IP, Device, Location, Rate, FailedLogin
 * 2. Post-auth: Supplement with User, UserDevice evaluation
 * 3. Generate comprehensive risk decision and set to request.risk
 * 4. Graceful degradation on errors — **graded**（批次 8 / B2 起）
 *
 * Design:
 * - Risk Guard executes once pre-authentication (Pre Auth)
 * - Risk Guard executes once post-authentication (Post Auth), merging results
 * - CAP Guard reads the decision and executes blocking if needed
 *
 * ## 降级分级（批次 8 / B2，Lead 2026-11 拍板）
 *
 * 旧行为：「未知异常」与「拿不到 deviceId」两种情况下都 `return true` 且不写
 * `request.risk` ⇒ 叠加 `cap.guard.ts` 的 `recommendation === undefined` 放行 =
 * **风控一挂 / 请求没有 deviceId 时机器人防护完全不执行**。那是「不拦」，不是降级拦截。
 *
 * 现在按端点敏感度分级（清单唯一真源：`./risk.sensitivity.ts`）：
 * - **敏感端点**（凭据面：登录 / 注册 / 重置口令 / OTP·MFA 校验 / 签发与刷新凭据 /
 *   `security/sign/*` 握手）⇒ fail-close，受控 40667；
 * - **其余端点** ⇒ fail-open（放行），并把降级原因写进 `request.riskDegraded`，由成功
 *   拦截器透出成响应壳的 `meta.riskDegraded`（不只打日志）。
 *
 * 不做全局 fail-close 的理由：本仓没有风控 SLA，全局关闭等于把风控服务变成全站单点。
 */
@Injectable()
export class WalnutAdminGuardRisk implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardRisk.name)

  constructor(
    private readonly riskService: SecurityRiskService,
    private readonly rateService: SecurityRiskRateService,
  ) { }

  /**
   * 风控不可用时的收口（批次 8 / B2）—— 分级：敏感端点 fail-close，其余 fail-open + 留痕。
   *
   * 调用点只有三处：pre-auth 无 deviceId、post-auth 无 deviceId、评估抛未知异常。
   * 返 true 的语义是「放行但已经留痕」，调用方直接 return 它。
   */
  private degradeOrReject(request: IWalnutAdminExpressRequest, reason: WalnutAdminRiskDegradedReason): true {
    if (isWalnutAdminRiskFailClose(request.method, request.path)) {
      const routeKey = walnutAdminRiskRouteKey(request.method, request.path)
      const matched = resolveWalnutAdminRiskSensitivity(request.method, request.path)
      this.logger.error(`Risk unavailable on fail-close endpoint (${routeKey}): ${reason} — ${matched?.reason ?? 'unclassified'}`)
      throw new WalnutAdminExceptionRiskUnavailable(`${reason} @ ${routeKey}`)
    }

    // fail-open + 留痕：request.riskDegraded 由成功拦截器透出为 meta.riskDegraded
    request.riskDegraded = reason
    this.logger.warn(`Risk unavailable, degraded to fail-open (${walnutAdminRiskRouteKey(request.method, request.path)}): ${reason}`)

    return true
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()

    try {
      const userId = request.user?.userId
      const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)
      const ip = request.realIp
      // TODO identifier
      const reqBody = request.body as Recordable
      const identifier = reqBody?.userName as string || reqBody?.emailAddress as string || reqBody?.phoneNumber as string

      const startTime = AppDayjs().valueOf()

      // ============================================================
      // Case 1: Pre-authentication (no userId)
      // ============================================================

      if (isNil(userId)) {
        this.logger.debug('Risk evaluation: Pre Auth stage')

        // rate collect
        if (!request._riskPreAuthCollected) {
          this.logger.debug('[Rate Collect] Pre-Auth - First time')
          fireAndForget(this.rateService.collectPreAuth(request.path, ip, deviceId), this.logger, 'risk rate collect (pre-auth)')
          request._riskPreAuthCollected = true // 标记已执行
        }
        else {
          this.logger.debug('[Rate Skip] Pre-Auth - Already collected')
        }

        if (!deviceId) {
          // 批次 8 / B2：不能评估（没有 deviceId）≠ 放行。敏感端点 fail-close（40667），
          // 其余端点 fail-open + meta.riskDegraded 留痕。
          this.logger.warn('No deviceId available, skipping Pre Auth risk evaluation')
          return this.degradeOrReject(request, 'no-device-id')
        }

        // 生成综合风险决策（仅 Pre Auth）
        const comprehensive = await this.riskService.evaluateComprehensivePreAuth({
          ip,
          deviceId,
          identifier,
        })

        request.risk = {
          comprehensive,
          timestamp: AppDayjs().valueOf(),
          evaluationDuration: AppDayjs().valueOf() - startTime,
        }

        // P1-13（2026-10-28，产品口径「风险只触发 CAP 升级，不做阻塞」）：阻塞腿
        // 已随 recommendation.shouldBlock 一并摘除 —— 风险结果由 CAP guard 消费
        // （shouldChallenge → 40116/40117），本 guard 不再自行拒绝请求。

        this.logger.debug(
          `Pre Auth risk evaluation completed - Score: ${comprehensive.overallScore}, `
          + `Level: ${comprehensive.overallLevel}, ShouldChallenge: ${comprehensive.recommendation.shouldChallenge}`,
        )

        return true
      }

      // ============================================================
      // Case 2: Post-authentication (has userId)
      // ============================================================

      this.logger.debug('Risk evaluation: Post Auth stage')

      if (!request._riskPostAuthCollected) {
        this.logger.debug('[Rate Collect] Post-Auth')
        fireAndForget(this.rateService.collectPostAuth(request.path, userId), this.logger, 'risk rate collect (post-auth)')
        request._riskPostAuthCollected = true // 标记已执行
      }
      else {
        this.logger.debug('[Rate Skip] Post-Auth - Already collected')
      }

      // 必须复用 Pre Auth 结果
      const preAuth = request.risk?.comprehensive?.preAuth
      if (isNil(preAuth)) {
        this.logger.warn('No Pre Auth result found, creating empty Pre Auth result')
        // Create empty Pre Auth result if missing (in case Pre Auth Guard was bypassed)
        // This shouldn't normally happen, but is a defensive measure
      }

      if (!deviceId) {
        // 批次 8 / B2：同 pre-auth —— 敏感端点 fail-close，其余 fail-open + 留痕
        this.logger.warn('No deviceId available, skipping Post Auth risk evaluation')
        return this.degradeOrReject(request, 'no-device-id')
      }

      // 合并 Pre Auth + Post Auth，生成综合风险决策
      const comprehensive = await this.riskService.evaluateComprehensivePostAuth({ preAuth, userId, deviceId, ip })

      // 更新 request.risk（合并结果）
      request.risk = {
        comprehensive,
        timestamp: AppDayjs().valueOf(),
        evaluationDuration: AppDayjs().valueOf() - startTime,
      }

      // P1-13：同 Pre Auth —— 风险只由 CAP guard 升级验证，不做阻塞

      this.logger.debug(
        `Post Auth risk evaluation completed - Score: ${comprehensive.overallScore}, `
        + `Level: ${comprehensive.overallLevel}, ShouldChallenge: ${comprehensive.recommendation.shouldChallenge}`,
      )

      return true
    }
    catch (error) {
      // P1-13：受控 HTTP 异常（如未来接入的 RiskTooHigh 40666）必须放行到全局异常
      // 过滤器，不能被「优雅降级」吞成 20000；未知异常仍按降级放行。
      if (error instanceof HttpException) {
        throw error
      }

      // 评估失败时的收口（批次 8 / B2）：旧实现一律 `return true` ⇒ 风控服务一挂，
      // 机器人防护在**所有**端点静默缺席（含登录 / 刷新凭据）。现在按端点分级：
      // 敏感端点 40667 fail-close，其余 fail-open + meta.riskDegraded 留痕。
      this.logger.error(error)
      return this.degradeOrReject(request, 'risk-evaluation-failed')
    }
  }
}

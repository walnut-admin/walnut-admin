import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminExceptionRiskTooHigh } from '@walnut-server/exceptions/base/406'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { Recordable } from 'easy-fns-ts'
import { isNil } from 'lodash'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { SecurityRiskRateService } from '@/modules/security/risk/modules/rate.service'
import { SecurityRiskService } from '@/modules/security/risk/risk.service'

/**
 * Risk Guard - Risk assessment (supports both pre and post authentication)
 *
 * Responsibilities (assessment only, no blocking):
 * 1. Pre-auth: Evaluate IP, Device, Location, Rate, FailedLogin
 * 2. Post-auth: Supplement with User, UserDevice evaluation
 * 3. Generate comprehensive risk decision and set to request.risk
 * 4. Graceful degradation on errors, allowing request to continue
 *
 * Design:
 * - Risk Guard executes once pre-authentication (Pre Auth)
 * - Risk Guard executes once post-authentication (Post Auth), merging results
 * - CAP Guard reads the decision and executes blocking if needed
 */
@Injectable()
export class WalnutAdminGuardRisk implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardRisk.name)

  constructor(
    private readonly riskService: SecurityRiskService,
    private readonly rateService: SecurityRiskRateService,
  ) { }

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
          void this.rateService.collectPreAuth(request.path, ip, deviceId)
          request._riskPreAuthCollected = true // 标记已执?
        }
        else {
          this.logger.debug('[Rate Skip] Pre-Auth - Already collected')
        }

        if (!deviceId) {
          this.logger.warn('No deviceId available, skipping Pre Auth risk evaluation')
          return true
        }

        // 生成综合风险决策（仅 Pre Auth�?
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

        // 检查是否需要阻塞请�?
        if (comprehensive?.recommendation.shouldBlock) {
          throw new WalnutAdminExceptionRiskTooHigh()
        }

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
        void this.rateService.collectPostAuth(request.path, userId)
        request._riskPostAuthCollected = true // 标记已执?
      }
      else {
        this.logger.debug('[Rate Skip] Post-Auth - Already collected')
      }

      // 必须�?Pre Auth 结果
      const preAuth = request.risk?.comprehensive?.preAuth
      if (isNil(preAuth)) {
        this.logger.warn('No Pre Auth result found, creating empty Pre Auth result')
        // Create empty Pre Auth result if missing (in case Pre Auth Guard was bypassed)
        // This shouldn't normally happen, but is a defensive measure
      }

      if (!deviceId) {
        this.logger.warn('No deviceId available, skipping Post Auth risk evaluation')
        return true
      }

      // 合并 Pre Auth + Post Auth，生成综合风险决�?
      const comprehensive = await this.riskService.evaluateComprehensivePostAuth({ preAuth, userId, deviceId, ip })

      // 更新 request.risk（合并结果）
      request.risk = {
        comprehensive,
        timestamp: AppDayjs().valueOf(),
        evaluationDuration: AppDayjs().valueOf() - startTime,
      }

      // 检查是否需要阻塞请�?
      if (comprehensive?.recommendation.shouldBlock) {
        throw new WalnutAdminExceptionRiskTooHigh()
      }

      this.logger.debug(
        `Post Auth risk evaluation completed - Score: ${comprehensive.overallScore}, `
        + `Level: ${comprehensive.overallLevel}, ShouldChallenge: ${comprehensive.recommendation.shouldChallenge}`,
      )

      return true
    }
    catch (error) {
      // 评估失败时降级：不拦截，继续
      this.logger.error(error)
      return true
    }
  }
}

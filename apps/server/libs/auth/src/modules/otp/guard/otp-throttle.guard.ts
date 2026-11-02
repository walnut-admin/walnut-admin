import type { ThrottlerRequest } from '@nestjs/throttler'
import { Injectable, Logger, Type } from '@nestjs/common'
import { ModuleRef, Reflector } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler'
import { isNil } from 'lodash'
import { otpType } from '../const/otp.const'
import { OtpVerifyDTO } from '../dto/otp.dto'
import { OTP_THROTTLE_SERVICE_KEY } from './otp-throttle.const'

// Note: IWalnutAdminOtpThrottleConfigProvider interface has been moved to @walnut-server/types/walnut-admin/guard.d.ts
// as IWalnutAdminOtpThrottleConfigProvider

/**
 * Throttler Guard for OTP module
 * Dynamically applies rate limits based on request body type (email/sms)
 */
@Injectable()
export class OtpThrottleGuard extends ThrottlerGuard {
  // @nestjs/throttler 6.7 起基类声明 protected logger（Nest 12 类型检查要求可见性一致）
  protected readonly logger = new Logger(OtpThrottleGuard.name)

  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {
    super(options, storageService, reflector)
  }

  protected async getTracker(req: IWalnutAdminExpressRequest): Promise<string> {
    // Use identifier (email/phone) + IP as tracker
    const body = req.body as { identifier?: string } | undefined
    const identifier = body?.identifier
    const ip = req.realIp
    return identifier !== undefined && identifier !== '' ? `${identifier}:${ip}` : ip
  }

  async handleRequest(requestProps: ThrottlerRequest) {
    const { context } = requestProps
    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()

    // P1-16：动态 ttl 同步覆盖 blockDuration（与 WalnutAdminGuardThrottler 的 P1-10
    // 修复同口径）—— 否则封禁窗口仍是全局 ttl，600s 的 sendTtl 只约束计数窗不约束封禁。
    let { limit, ttl, blockDuration } = requestProps

    // Get the service from metadata (shared symbol exported by otp.decorator)
    const TargetService = this.reflector.getAllAndOverride<Type<IWalnutAdminOtpThrottleConfigProvider>>(
      OTP_THROTTLE_SERVICE_KEY,
      [context.getHandler(), context.getClass()],
    )

    if (!isNil(TargetService)) {
      const service = this.moduleRef.get<IWalnutAdminOtpThrottleConfigProvider>(TargetService, {
        strict: false,
      })

      if (!isNil(service)) {
        // Get type from request body
        const type = (request.body as OtpVerifyDTO).type

        // Apply dynamic config if type is valid
        if (type && Object.values(otpType).includes(type)) {
          try {
            const dynamicLimit = await service.getThrottleLimit(type)
            const dynamicTtl = await service.getThrottleTtl(type)

            if (Number.isFinite(dynamicLimit)) {
              limit = dynamicLimit
            }

            if (Number.isFinite(dynamicTtl)) {
              ttl = dynamicTtl * 1000 // Convert to milliseconds
              blockDuration = ttl
            }

            this.logger.debug(`[OTP Throttle] ${type} ?limit=${limit}, ttl=${ttl}, blockDuration=${blockDuration}`)
          }
          catch (error) {
            this.logger.error(`Failed to get throttle config for ${type}:`, error)
          }
        }
      }
    }

    return super.handleRequest({
      ...requestProps,
      limit,
      ttl,
      blockDuration,
    })
  }
}

import type { ThrottlerRequest } from '@nestjs/throttler'
import { Injectable, Logger, Type } from '@nestjs/common'
import { ModuleRef, Reflector } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler'
import { isNil } from 'lodash'
import { otpType } from '../const/otp.const'
import { OtpVerifyDTO } from '../dto/otp.dto'

// Note: IWalnutAdminOtpThrottleConfigProvider interface has been moved to @walnut/types/walnut-admin/guard.d.ts
// as IWalnutAdminOtpThrottleConfigProvider

/**
 * Throttler Guard for OTP module
 * Dynamically applies rate limits based on request body type (email/sms)
 */
@Injectable()
export class OtpThrottleGuard extends ThrottlerGuard {
  private readonly logger = new Logger(OtpThrottleGuard.name)

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

    let { limit, ttl } = requestProps

    // Get the service from metadata (key defined in decorator)
    const TargetService = this.reflector.getAllAndOverride<Type<IWalnutAdminOtpThrottleConfigProvider>>(
      'OTP_THROTTLE_SERVICE',
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
            }

            this.logger.debug(`[OTP Throttle] ${type} ?limit=${limit}, ttl=${ttl}`)
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
    })
  }
}

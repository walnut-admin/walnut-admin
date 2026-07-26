import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'

import { WalnutAdminExceptionAccessTokenExpired, WalnutAdminExceptionSensitiveVerificationFailed } from '@walnut/exceptions/business/auth'
import { isNil } from 'lodash'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { getOperationStrategy } from '@/modules/security/sensitive/sensitive.config'
import { SecuritySensitiveService } from '@/modules/security/sensitive/sensitive.service'
import { IWalnutAdminGuardRequireSensitiveOptions } from '@/modules/security/sensitive/sensitive.type'

const WALNUT_ADMIN_REQUIRE_SENSITIVE_KEY = Symbol('WALNUT_ADMIN_CONST_DECORATOR_REQUIRE_SENSITIVE')

/**
 * Decorator to mark an endpoint as requiring sensitive operation verification
 */
export function WalnutAdminGuardRequireSensitive(
  options: IWalnutAdminGuardRequireSensitiveOptions,
) {
  return applyDecorators(
    SetMetadata(WALNUT_ADMIN_REQUIRE_SENSITIVE_KEY, options),
    UseGuards(WalnutAdminGuardSensitive),
  )
}

@Injectable()
export class WalnutAdminGuardSensitive implements CanActivate {
  constructor(
    private readonly sensitiveService: SecuritySensitiveService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    const user = request.user

    // Get deviceId from cookie
    const deviceId = getWalnutAdminCookie(
      request,
      WalnutAdminConstCookieKeys.DEVICE_ID,
    )

    // Get decorator options
    const options = this.reflector.get<IWalnutAdminGuardRequireSensitiveOptions>(
      WALNUT_ADMIN_REQUIRE_SENSITIVE_KEY,
      context.getHandler(),
    )

    if (isNil(options)) {
      return true
    }

    if (!user) {
      throw new WalnutAdminExceptionAccessTokenExpired()
    }

    // Check if user has permission for this security level (with deviceId)
    const hasPermission = await this.sensitiveService.hasPermission(
      user.userId,
      deviceId,
      options.level,
    )

    if (!hasPermission) {
      const strategy = getOperationStrategy(options.level, options.type)

      const meta = await this.sensitiveService.checkVerificationStatus(
        user.userId,
        deviceId,
        options.level,
        strategy.supportedMethods,
      )

      // Throw error to trigger frontend verification flow
      throw new WalnutAdminExceptionSensitiveVerificationFailed({
        meta,
      })
    }

    return true
  }
}

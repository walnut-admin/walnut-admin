import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'

import { getWalnutAdminCookie } from '@walnut-server/cookie'
import {
  WalnutAdminExceptionAccessTokenExpired,
  WalnutAdminExceptionSensitiveVerificationFailed,
} from '@walnut-server/exceptions/business/auth'
import { getOperationStrategy } from '@walnut-server/security/sensitive/sensitive.config'
import { SecuritySensitiveService } from '@walnut-server/security/sensitive/sensitive.service'
import { IWalnutAdminGuardRequireSensitiveOptions } from '@walnut-server/security/sensitive/sensitive.type'
import { isNil } from 'lodash'

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
    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)

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
      //
      // `level` / `operationType` 必须随 meta 一起下发：`POST /security/sensitive/verify`
      // 两者都是**必填**（operationType 缺省时 controller 直接 40099），而客户端无法从
      // 40119 响应或自己的请求里推导它们 —— 守卫挂在任意端点，level/type 只存在于服务端
      // 装饰器元数据里。缺了这两个键，前端只能猜（例如把 account_critical 写死），
      // 一遇到别的 level 就会静默失败。这是 40119 挑战描述符的一部分，不是新机制。
      throw new WalnutAdminExceptionSensitiveVerificationFailed({
        meta: { ...meta, level: options.level, operationType: options.type },
      })
    }

    return true
  }
}

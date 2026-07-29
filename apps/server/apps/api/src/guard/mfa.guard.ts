import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { CanActivate, ExecutionContext, Injectable, Logger, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { Role } from '@walnut/contract'
import { WalnutAdminExceptionMfaRequired, WalnutAdminExceptionMfaVerifyFailed } from '@walnut-server/exceptions/business/auth'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { AppTechCacheMfaService } from '@/modules/techniques/cache/service/cache.mfa'

const WalnutAdminConstDecoratorMFAKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_MFA_FREE')

export function WalnutAdminGuardMFAFree() {
  return SetMetadata(WalnutAdminConstDecoratorMFAKey, true)
}

@Injectable()
export class WalnutAdminGuardMFA implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardMFA.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheMfaService: AppTechCacheMfaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    // P1: MFA free decorator
    const mfaFree = this.reflector.getAllAndOverride<boolean>(
      WalnutAdminConstDecoratorMFAKey,
      [context.getHandler(), context.getClass()],
    )
    if (mfaFree) {
      this.logger.debug('MFA check bypassed for MFA-free endpoint')
      return true
    }

    // P3: skip for unauthenticated users
    const user = request.user
    if (!user) {
      this.logger.debug('MFA check skipped: user not found in request')
      return true
    }

    // P4: skip for visitor role
    if (user.roleMode === WalnutAdminConstRoleMode.SWITCH && user.currentRoleName === Role.VISITOR) {
      this.logger.debug('MFA check skipped: visitor role')
      return true
    }

    // P5: check mfa setup status
    if (!user.mfaSetup) {
      this.logger.warn(`MFA not setup for user: ${user.userId}`)
      throw new WalnutAdminExceptionMfaRequired() // 40114
    }

    // P6: check mfa Verified status
    if (user.mfaVerified) {
      this.logger.debug(`MFA already verified in session: userId=${user.userId}`)
      return true
    }

    // P7: temp trust this device has cache
    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)
    const isTempVerified = await this.cacheMfaService.getVerifiedCache(user.userId, deviceId)
    if (isTempVerified) {
      this.logger.debug(`MFA verified via device cache: userId=${user.userId}, deviceId=${deviceId}`)
      return true
    }

    this.logger.warn(`MFA verification required: userId=${user.userId}, deviceId=${deviceId}`)
    throw new WalnutAdminExceptionMfaVerifyFailed() // 40115
  }
}

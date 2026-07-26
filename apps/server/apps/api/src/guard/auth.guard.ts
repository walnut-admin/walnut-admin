import type {
  ExecutionContext,
} from '@nestjs/common'
import {
  HttpException,
  Inject,
  Logger,
} from '@nestjs/common'

import { AuthGuard } from '@nestjs/passport'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { SysLogAuthSharedService } from '@/modules/system/logs/auth/shared/log.auth.shared.service'

/**
 * Walnut Admin Auth Guard (Mixin Factory)
 */
export function WalnutAdminGuardAuth(strategy: string) {
  class WalnutAdminAuthGuardMixin extends AuthGuard(strategy) {
    protected readonly logger = new Logger(WalnutAdminGuardAuth.name)

    @Inject(SysLogAuthSharedService)
    private readonly logAuthSharedService: SysLogAuthSharedService

    constructor() {
      super()
    }

    handleRequest<TUser = any>(
      err: any,
      user: TUser,
      info: any,
      context: ExecutionContext,
    ): TUser {
      const req = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()

      /** ===== success, just return user ===== */
      if (err === null && user !== null) {
        return user
      }

      /** ===== failed, record auth log and failed login risk ===== */
      const deviceId = getWalnutAdminCookie(req, WalnutAdminConstCookieKeys.DEVICE_ID)
      const identifier = req.identifier!

      const originMsg = err instanceof HttpException
        ? (err.getResponse() as IWalnutAdminResponseExceptionBase).errMsg
        : (err as Error).message

      const payloadAuthType = this.logAuthSharedService.getAuthLogTypeFromMetadata(context)

      void this.logAuthSharedService.recordAuth({
        request: req,
        authType: payloadAuthType!,
        identifier,
        deviceId,
        success: false,
        errI18nMsg: originMsg,
      }).catch((e) => {
        this.logger.error('record auth error', e)
      })

      throw err
    }
  }

  return WalnutAdminAuthGuardMixin
}

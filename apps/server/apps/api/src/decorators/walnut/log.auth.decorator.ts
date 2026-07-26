import { applyDecorators, CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, SetMetadata, UseInterceptors } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'
import { IWalnutAdminConstDecoratorLogAuthType } from '@walnut/const/decorator/logAuth'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { SysLogAuthSharedService } from '@/modules/system/logs/auth/shared/log.auth.shared.service'
import { getWalnutAdminCookie } from './cookie.decorator'

export const WalnutAdminConstDecoratorLogAuthMetadataKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_METADATA_KEY_LOG_AUTH')

@Injectable()
export class WalnutAdminInterceptorRequestAuthLog implements NestInterceptor {
  private readonly logger = new Logger(WalnutAdminInterceptorRequestAuthLog.name)

  constructor(
    private readonly logAuthSharedService: SysLogAuthSharedService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    const payloadAuthType = this.logAuthSharedService.getAuthLogTypeFromMetadata(context)
    if (!payloadAuthType) {
      this.logger.warn('No auth log type found in metadata')
      return next.handle()
    }

    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)
    const identifier = request.identifier!

    return next.handle().pipe(
      tap({
        next: () => {
          void this.logAuthSharedService.recordAuth({
            request,
            authType: payloadAuthType,
            identifier,
            deviceId,
            success: true,
          })
        },
        error: () => {
          void this.logAuthSharedService.recordAuth({
            request,
            authType: payloadAuthType,
            identifier,
            deviceId,
            success: false,
          })
        },
      }),
    )
  }
}

/**
 * @description Custom auth log decorator, only used for auth endpoint
 */
export function WalnutAdminDecoratorAuthLog(type: IWalnutAdminConstDecoratorLogAuthType) {
  return applyDecorators(
    SetMetadata(WalnutAdminConstDecoratorLogAuthMetadataKey, type),
    UseInterceptors(WalnutAdminInterceptorRequestAuthLog),
  )
}

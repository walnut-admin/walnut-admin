import { applyDecorators, CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, SetMetadata, UseInterceptors } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { IWalnutAdminConstDecoratorLogAuthType, WalnutAdminConstDecoratorLogAuthMetadataKey } from '@walnut-server/const/decorator/logAuth'
import { getWalnutAdminCookie } from '@walnut-server/cookie'
import { SysLogAuthSharedService } from '@walnut-server/system'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'

// 批 7：元数据键随 system logs/auth 下沉 libs/const（读方在 lib、写方在 app，同一个 Symbol
// 必须在更低层）。V5：本 decorator 再下沉 libs/guards，消费方统一 import
// `@walnut-server/guards`；re-export 保持元数据键的既有取用面。
export { WalnutAdminConstDecoratorLogAuthMetadataKey }

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

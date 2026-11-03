import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstDecoratorFreeResponseMetadataKey } from '@walnut-server/const/decorator/response'

import { setCustomHeaders } from '@walnut-server/utils/headers'
import {
  WalnutAdminResponseSuccess,
} from '@walnut-server/utils/response'
import { I18nContext } from 'nestjs-i18n'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

@Injectable()
export class WalnutAdminInterceptorResponseSuccess implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<IWalnutAdminResponseBase>> {
    if (context.getType() === 'http') {
      const i18n = I18nContext.current()!

      const successMsg = i18n.t('response.20000')

      setCustomHeaders(context)

      return next.handle().pipe(
        map((data: IWalnutAdminResponseBase) => {
          const freeResponse: string = this.reflector.getAllAndOverride(
            WalnutAdminConstDecoratorFreeResponseMetadataKey.FREE_RESPONSE,
            [context.getHandler()],
          )

          if (freeResponse) {
            return data
          }

          const ctx = context.switchToHttp()
          const request = ctx.getRequest<IWalnutAdminExpressRequest>()

          // 批次 8 / B2：风控不可用但端点不敏感 ⇒ 放行 + 留痕。
          // 留痕走**响应壳**（meta.riskDegraded）而不是只打日志：不敏感端点维持 fail-open
          // 是既定口径，但「这条 200 是在机器人防护缺席时放行的」必须能被排查到 ——
          // 前端排障、运维看请求日志、自动化回归都能直接读到。
          // 敏感端点在 guard 层就已 40667 拒绝，永远走不到这条 200。
          const meta = request.riskDegraded === undefined
            ? undefined
            : { riskDegraded: request.riskDegraded }

          return WalnutAdminResponseSuccess(data, request.id, successMsg, meta)
        }),
      )
    }

    return next.handle()
  }
}

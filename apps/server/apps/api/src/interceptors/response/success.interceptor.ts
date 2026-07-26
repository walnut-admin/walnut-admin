import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstDecoratorFreeResponseMetadataKey } from '@walnut/const/decorator/response'

import { setCustomHeaders } from '@walnut/utils/headers'
import {
  WalnutAdminResponseSuccess,
} from '@walnut/utils/response'
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

          return WalnutAdminResponseSuccess(data, request.id, successMsg)
        }),
      )
    }

    return next.handle()
  }
}

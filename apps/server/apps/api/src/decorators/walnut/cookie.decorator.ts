import type { ExecutionContext } from '@nestjs/common'
import type { IWalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'
import { createParamDecorator } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut/exceptions/base.exception'

export const WalnutAdminDecoratorCookie = createParamDecorator(
  (key: IWalnutAdminConstCookieKeys, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    return getWalnutAdminCookie(request, key)
  },
)

export function getWalnutAdminCookie(req: IWalnutAdminExpressRequest, key: IWalnutAdminConstCookieKeys) {
  try {
    return req.signedCookies[key as keyof typeof req.signedCookies] as string
  }
  catch {
    throw new WalnutAdminExceptionBadRequest()
  }
}

import type { ExecutionContext } from '@nestjs/common'
import { createParamDecorator } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'
import { getWalnutAdminCookie } from './cookie.decorator'

export const WalnutAdminDecoratorUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): IWalnutAdminAccessTokenPayload => {
    const request = ctx.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    return request.user!
  },
)

export const WalnutAdminDecoratorJti = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    return getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.RT_JTI)
  },
)

export const WalnutAdminDecoratorDeviceId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    return getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)
  },
)

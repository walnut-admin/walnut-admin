import { ExecutionContext, Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'
import { WalnutAdminExceptionRefreshTokenExpired } from '@walnut-server/exceptions/business/auth'
import { isNil } from 'lodash'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { AuthRefreshSharedService } from './shared/refresh.shared.service'

@Injectable()
export class JwtRefreshGuard extends AuthGuard(
  WalnutAdminConstAppAuthStrategy.JWT_REFRESH_TOKEN,
) {
  constructor(
    private readonly authRefreshSharedService: AuthRefreshSharedService,
  ) {
    super({
      property: 'RT',
    })
  }

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()

    const token = await this.authRefreshSharedService.getTokenByJti(
      getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.RT_JTI),
    )

    // put the real refresh token in request
    request.realRefreshToken = token

    return super.canActivate(context) as Promise<boolean>
  }

  // logic below will not excute, cause `ignoreExpiration` set to true
  handleRequest<TUser>(err: any, payload: TUser, _info: any): TUser {
    // You can throw an exception based on either "info" or "err" arguments
    if (!isNil(err) || isNil(payload) || payload === false) {
      throw new WalnutAdminExceptionRefreshTokenExpired()
    }

    return payload
  }
}

import { ExecutionContext, Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

import { AuthRefreshSharedService } from '@walnut-server/auth'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'
import { getWalnutAdminCookie } from '@walnut-server/cookie'
import { WalnutAdminExceptionRefreshTokenExpired } from '@walnut-server/exceptions/business/auth'
import { isNil } from 'lodash'

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

    // 查无或已撤销（revoke-and-insert 轮换后的旧行）→ 40102：重放/错峰迟到请求在
    // guard 层即死，不进轮换事务
    const rawToken = await this.authRefreshSharedService.getTokenByJti(
      getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.RT_JTI),
    )

    // put the real refresh token in request（passport 策略从这取值验签）
    request.realRefreshToken = rawToken

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

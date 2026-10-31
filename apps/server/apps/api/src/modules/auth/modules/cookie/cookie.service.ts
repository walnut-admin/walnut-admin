import { Injectable } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { AppTechCookieService } from '@walnut-server/cookie'
import { AppTokenService } from '@/modules/shared/token/token.service'

@Injectable()
export class AuthCookieService {
  constructor(
    private readonly tokenService: AppTokenService,
    private readonly cookieService: AppTechCookieService,
  ) {}

  /**
   * @description set refresh token jti into cookie
   */
  setRTJtiCookie(req: IWalnutAdminExpressRequest, jti: string) {
    const rtMaxAge = this.tokenService.getRefreshTokenExpireSeconds() * 1000
    this.cookieService.setResponseCookie(req, [
      { key: WalnutAdminConstCookieKeys.RT_JTI, value: jti, options: { maxAge: rtMaxAge } },
    ])
  }
}

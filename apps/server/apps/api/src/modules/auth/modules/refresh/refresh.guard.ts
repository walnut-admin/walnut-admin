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

    const { rawToken, encryptedToken } = await this.authRefreshSharedService.getTokenByJti(
      getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.RT_JTI),
    )

    // put the real refresh token in request
    request.realRefreshToken = rawToken
    // P0-1（2026-10-26 修复）：入口时刻的 encrypted_token 快照 —— 轮换锁内的重放
    // 比对真源（AES-GCM 随机 IV，任何轮换后密文必变；RT 原文同秒再签会字节全同，
    // 不能作判定依据，见 getTokenByJti 注释）
    request.realRefreshTokenEncrypted = encryptedToken

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

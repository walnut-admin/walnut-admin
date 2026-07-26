import { Injectable, Logger } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { WalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'
import { WalnutAdminConstAppAuthStrategy } from '@walnut/const/app/strategy'
import { Strategy } from 'passport-local'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { AuthOpaqueUserService } from './opaque.user.service'

@Injectable()
export class AuthOpaqueUserStrategy extends PassportStrategy(
  Strategy,
  WalnutAdminConstAppAuthStrategy.AUTH_OPAQUE,
) {
  private readonly logger = new Logger(AuthOpaqueUserStrategy.name)

  constructor(
    private readonly authOpaqueUserService: AuthOpaqueUserService,
  ) {
    super({
      usernameField: 'userName',
      passwordField: 'finish',
      passReqToCallback: true,
    })
  }

  async validate(
    request: IWalnutAdminExpressRequest,
    userName: string,
    finish: string,
  ) {
    this.logger.log(`validate: ${userName}, ${finish}`)

    request.identifier = userName

    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)

    return this.authOpaqueUserService.validateOpaqueUser(userName, finish, deviceId)
  }
}

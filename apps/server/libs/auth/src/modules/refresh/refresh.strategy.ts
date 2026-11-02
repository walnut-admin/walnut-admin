import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'
import { ExtractJwt, Strategy } from 'passport-jwt'

@Injectable()
export class JwtRefreshTokenStrategy extends PassportStrategy(
  Strategy,
  WalnutAdminConstAppAuthStrategy.JWT_REFRESH_TOKEN,
) {
  constructor(
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: IWalnutAdminExpressRequest) => request?.realRefreshToken,
      ]),
      // set true to get payload after token is expired
      // Q: is this safe? A: payload is jti only, which is random string, so safe
      ignoreExpiration: true,
      secretOrKey: configService.get('jwt.refresh.secret') as string,
    })
  }

  async validate(
    payload: IWalnutAdminRefreshTokenPayload,
  ): Promise<IWalnutAdminRefreshTokenPayload> {
    return {
      sid: payload.sid,
      jti: payload.jti,
    }
  }
}

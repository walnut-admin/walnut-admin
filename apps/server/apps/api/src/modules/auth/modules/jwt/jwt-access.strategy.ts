import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'
import { ExtractJwt, Strategy } from 'passport-jwt'

@Injectable()
export class JwtAccessTokenStrategy extends PassportStrategy(
  Strategy,
  WalnutAdminConstAppAuthStrategy.JWT_ACCESS_TOKEN,
) {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.access.secret') as string,
    })
  }

  async validate(
    payload: IWalnutAdminAccessTokenPayload,
  ): Promise<IWalnutAdminAccessTokenPayload> {
    return payload
  }
}

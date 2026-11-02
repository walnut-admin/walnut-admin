import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'
import { getWalnutAdminCookie } from '@walnut-server/cookie'
import { WalnutAdminExceptionAccessTokenExpired } from '@walnut-server/exceptions/business/auth'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { AuthSessionService } from '../session/session.service'

/**
 * P0-4 修复（2026-10-28）：JWT 层不再只验「签名 + 未过期」，validate 补查登录会话键
 * （`AUTH:SESSIONS:<userId>:<deviceId>:<sessionId>`，键构造复用 AuthSessionService）。
 * 会话键缺失（登出/吊销/伪造 AT）→ 40101，不再依赖下游 sign guard 兜底；与 P0-2
 * 修复后的 sign guard 双因子校验构成双保险。
 *
 * 性能口径：每请求一次 Redis GET（会话键存在性），与 guard 链既有缓存查询同量级。
 */
@Injectable()
export class JwtAccessTokenStrategy extends PassportStrategy(
  Strategy,
  WalnutAdminConstAppAuthStrategy.JWT_ACCESS_TOKEN,
) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authSessionService: AuthSessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.access.secret') as string,
      passReqToCallback: true,
    })
  }

  async validate(
    req: IWalnutAdminExpressRequest,
    payload: IWalnutAdminAccessTokenPayload,
  ): Promise<IWalnutAdminAccessTokenPayload> {
    const deviceId = getWalnutAdminCookie(req, WalnutAdminConstCookieKeys.DEVICE_ID)

    const sessionKeyHash = payload.sid == null || deviceId == null
      ? null
      : await this.authSessionService.getAuthSessionKeyHash(payload.userId, deviceId, payload.sid)

    if (!sessionKeyHash) {
      throw new WalnutAdminExceptionAccessTokenExpired()
    }

    return payload
  }
}

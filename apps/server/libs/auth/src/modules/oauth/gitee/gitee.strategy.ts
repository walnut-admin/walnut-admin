import { Injectable, Logger } from '@nestjs/common'

import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'

import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'

import { getWalnutAdminCookie } from '@walnut-server/cookie'
import { maskEmail } from '@walnut-server/utils/mask'
import { OAuthGiteeService } from './gitee.service'
import { Strategy } from './strategy'
// Note: IWalnutAdminIWalnutAdminOAuthGiteeUserInfo is now IWalnutAdminIWalnutAdminOAuthGiteeUserInfo global type from @walnut-server/types

// https://gitee.com/oauth/applications
export const OAuthGiteeScope = ['user_info', 'emails']

@Injectable()
export class OAuthGiteeStrategy extends PassportStrategy(
  // @ts-expect-error do-not-wanna-handle
  Strategy,
  WalnutAdminConstAppAuthStrategy.OAUTH_GITEE,
) {
  private readonly logger = new Logger(OAuthGiteeStrategy.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly oauthGiteeService: OAuthGiteeService,
  ) {
    super({
      passReqToCallback: true,
      clientID: configService.get<string>('auth.gitee.clientId'),
      clientSecret: configService.get<string>('auth.gitee.clientSecret'),
      callbackURL: configService.get<string>('auth.gitee.callbackURL'),
      scope: OAuthGiteeScope,
    })
  }

  async validate(
    request: IWalnutAdminExpressRequest,
    _accessToken: string,
    _refreshToken: string,
    profile: IWalnutAdminOAuthGiteeUserInfo,
  ) {
    // F-06（与 github.strategy 同款漏点，清单外补齐）：profile 是 PII，整串 JSON 不入日志；
    // 只打 provider 侧 id 与掩码邮箱。
    this.logger.log(
      `oauth gitee: id=${profile.id}, email=${maskEmail(profile.email)}`,
    )

    const { id, name, email, avatar_url } = profile

    // Set identifier to request for later use
    request.identifier = email

    // Get device id from cookie
    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)

    // Validate user identity
    return this.oauthGiteeService.validateIdentity(
      id,
      name,
      email,
      avatar_url,
      request.language,
      deviceId,
    )
  }
}

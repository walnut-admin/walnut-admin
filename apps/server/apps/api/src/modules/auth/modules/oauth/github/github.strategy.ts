import { Injectable, Logger } from '@nestjs/common'

import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'

import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'

import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { OAuthGitHubService } from './github.service'
import { Strategy } from './strategy'
// Note: IWalnutAdminIWalnutAdminOAuthGitHubUserInfo is now IWalnutAdminIWalnutAdminOAuthGitHubUserInfo global type from @walnut-server/types

// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps#available-scopes
export const OAuthGitHubScope = ['read:user', 'user:email']

@Injectable()
export class OAuthGitHubStrategy extends PassportStrategy(
  // @ts-expect-error do-not-wanna-handle
  Strategy,
  WalnutAdminConstAppAuthStrategy.OAUTH_GITHUB,
) {
  private readonly logger = new Logger(OAuthGitHubStrategy.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly oauthGitHubService: OAuthGitHubService,
  ) {
    super({
      passReqToCallback: true,
      clientID: configService.get<string>('auth.github.clientId'),
      clientSecret: configService.get<string>('auth.github.clientSecret'),
      callbackURL: configService.get<string>('auth.github.callbackURL'),
      scope: OAuthGitHubScope,
    })
  }

  async validate(
    request: IWalnutAdminExpressRequest,
    _accessToken: string,
    _refreshToken: string,
    profile: IWalnutAdminOAuthGitHubUserInfo,
  ) {
    this.logger.log(`oauth github: ${JSON.stringify(profile)}`)

    const { id, login, email, avatar_url } = profile

    // Set identifier to request for later use
    request.identifier = email

    // Get device id from cookie
    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)

    // Validate user identity
    return this.oauthGitHubService.validateIdentity(
      id,
      login,
      email,
      avatar_url,
      request.language,
      deviceId,
    )
  }
}

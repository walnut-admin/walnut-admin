import { Module } from '@nestjs/common'

import { SysMenuSharedModule } from '../system/menu/shared/menu.shared.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthGoogleModule } from './modules/google/google.module'
import { JwtAccessTokenStrategy } from './modules/jwt/jwt-access.strategy'
import { AuthMfaModule } from './modules/mfa/mfa.module'
import { OAuthGiteeModule } from './modules/oauth/gitee/gitee.module'
import { OAuthGitHubModule } from './modules/oauth/github/github.module'
import { AuthOpaqueModule } from './modules/opaque/opaque.module'
import { OtpModule } from './modules/otp/otp.module'
import { AuthRefreshModule } from './modules/refresh/refresh.module'
import { AuthSessionModule } from './modules/session/session.module'
import { AuthSharedModule } from './modules/shared/shared.module'
import { AuthSignoutModule } from './modules/signout/signout.module'

const strategies = [
  // jwt
  JwtAccessTokenStrategy,
]

@Module({
  imports: [
    AuthSignoutModule,

    SysMenuSharedModule,
    AuthSessionModule,
    AuthSharedModule,

    AuthRefreshModule,
    OtpModule,
    AuthGoogleModule,
    AuthOpaqueModule,
    AuthMfaModule,

    // https://gitee.com/oauth/applications
    OAuthGiteeModule,
    // https://github.com/settings/developers
    OAuthGitHubModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, ...strategies],
  exports: [AuthService],
})
export class AuthModule {}

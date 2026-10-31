import { Module } from '@nestjs/common'

import { SysMenuSharedModule } from '@walnut-server/system'
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

/**
 * auth 域的聚合模块（libs 解耦批 8）。
 *
 * app 的 `modules/auth/auth.module.ts` 只 import 本聚合 + `AuthHttpModule`
 * （controller 与 passport mixin guard 的 HTTP 组合根）。子模块接入顺序与解耦前
 * `AuthModule` 完全一致（signout → menu shared → session → shared → refresh → otp →
 * google → opaque → mfa → gitee → github）—— Swagger 路径装配顺序不变。
 *
 * 说明：**controller 不在 lib 里**。auth 的 9 个 controller 依赖 wire DTO
 * （`SysUserDTOSafe`，swagger schema 注册顺序留 app）与 app 侧 guard 装配 ——
 * log.auth decorator 已在 V5 下沉 `@walnut-server/guards`；放进 lib 仍会形成
 * lib → app 反向依赖。它们由 app 的
 * `apps/api/src/modules/auth/auth-http.module.ts` 声明。
 *
 * `JwtAccessTokenStrategy` 与 `AuthService` 随域下沉；`JwtAccessGuard` 由 app
 * `APP_GUARD` 从 `@walnut-server/auth` 引用（类名与注册顺序不变）。
 */
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
  providers: [AuthService, JwtAccessTokenStrategy],
  exports: [
    AuthService,
    AuthSignoutModule,
    SysMenuSharedModule,
    AuthSessionModule,
    AuthSharedModule,
    AuthRefreshModule,
    OtpModule,
    AuthGoogleModule,
    AuthOpaqueModule,
    AuthMfaModule,
    OAuthGiteeModule,
    OAuthGitHubModule,
  ],
})
export class SysAuthModule {}

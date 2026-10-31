import { Module } from '@nestjs/common'
import {
  AuthCookieModule,
  AuthOpaqueAdminModule,
  AuthOpaqueCoreModule,
  AuthOpaqueUserModule,
  AuthRefreshSharedModule,
  OAuthStateModule,
  OtpFunctionalGuard,
  OtpSendFunctionalGuard,
  OtpThrottleGuard,
  SysAuthModule,
} from '@walnut-server/auth'
import { SysUserIdentitySharedModule } from '@walnut-server/identity'
import { AppTechSseModule } from '@walnut-server/sse'
import { AuthController } from './auth.controller'
import { AuthGoogleController } from './modules/google/google.controller'
import { AuthGoogleGuard } from './modules/google/google.guard'
import { AuthMfaController } from './modules/mfa/mfa.controller'
import { OAuthGiteeController } from './modules/oauth/gitee/gitee.controller'
import { OAuthGiteeGuard } from './modules/oauth/gitee/gitee.guard'
import { OAuthGithubController } from './modules/oauth/github/github.controller'
import { OAuthGitHubGuard } from './modules/oauth/github/github.guard'
import { AuthOpaqueAdminController } from './modules/opaque/admin/opaque.admin.controller'
import { AuthOpaqueUserController } from './modules/opaque/user/opaque.user.controller'
import { AuthOpaqueUserGuard } from './modules/opaque/user/opaque.user.guard'
import { OtpController } from './modules/otp/otp.controller'
import { OtpGuard } from './modules/otp/otp.guard'
import { AuthRefreshController } from './modules/refresh/refresh.controller'
import { JwtRefreshGuard } from './modules/refresh/refresh.guard'

/**
 * auth 域的 HTTP 组合根（libs 解耦批 8）。
 *
 * 为什么 controller 不在 libs/auth：它们依赖 guard / param decorator 层与
 * `SysUserDTOSafe` wire DTO（swagger schema 注册顺序留 app）—— 放进 lib 会立刻形成
 * lib → app 反向依赖；认证日志装饰器（原 app 的 `log.auth.decorator`）已在 V5 下沉
 * `@walnut-server/guards`。与批 5 的 rsa、批 6 的
 * identity http、批 7 的 system http 同款处置：数据面/服务下沉 lib，controller 留 app。
 *
 * 为什么 passport mixin guard 也留 app：它们继承 `@walnut-server/guards` 的
 * `WalnutAdminGuardAuth`；而 guards 的 SignGuard 依赖 auth 的 `AuthSessionService`。
 * 若把它们放进 libs/auth，依赖方向变成 auth → guards 且 guards → auth，形成 lib 环。
 *
 * controller 顺序与解耦前模块装载顺序一致
 * （auth → refresh → otp → google → opaque/user → opaque/admin → mfa → gitee → github），
 * openapi 路径顺序零 diff。
 */
@Module({
  imports: [
    SysAuthModule,
    // 控制器 / guard 的直接注入面：cookie 服务、RT 共享服务、OAuth state
    AuthCookieModule,
    AuthRefreshSharedModule,
    OAuthStateModule,
    // opaque 三个子模块的 service 导出面（AuthOpaqueModule 只聚合、不再导出子 provider）
    AuthOpaqueCoreModule,
    AuthOpaqueUserModule,
    AuthOpaqueAdminModule,
    // gitee / github controller 直接注入（原 OAuth*Module 的 import 面）
    AppTechSseModule,
    SysUserIdentitySharedModule,
  ],
  controllers: [
    AuthController,
    AuthRefreshController,
    OtpController,
    AuthGoogleController,
    AuthOpaqueUserController,
    AuthOpaqueAdminController,
    AuthMfaController,
    OAuthGiteeController,
    OAuthGithubController,
  ],
  providers: [
    AuthGoogleGuard,
    AuthOpaqueUserGuard,
    OAuthGiteeGuard,
    OAuthGitHubGuard,
    JwtRefreshGuard,
    OtpGuard,
    // OTP 装饰器组合的 functional / throttle 守卫（依赖 OtpSettingService 的导出面）
    OtpFunctionalGuard,
    OtpSendFunctionalGuard,
    OtpThrottleGuard,
  ],
})
export class AuthHttpModule {}

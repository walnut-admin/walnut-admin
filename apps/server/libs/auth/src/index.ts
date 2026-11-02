/**
 * auth 域 barrel（libs 解耦批 8）。
 *
 * jwt / mfa / otp / refresh / oauth(gitee·github) / opaque / session / signout / cookie
 * 九个 auth 子目录与根 auth.service 的 module / service / strategy / DTO / 常量全量导出。
 * controller 不在 lib（依赖 `SysUserDTOSafe` wire DTO，swagger schema 注册顺序留 app；
 * log.auth decorator 已在 V5 下沉 `@walnut-server/guards`），由 app 的
 * `auth-http.module.ts` 声明；passport mixin guard（Google / OAuth / Opaque /
 * OTP / Refresh）同样留 app —— 它们继承 `@walnut-server/guards` 的 AuthGuard mixin，
 * 放进本 lib 会让依赖方向变成 auth → guards 而 guards → auth（SignGuard 用
 * AuthSessionService），形成 lib 环。
 *
 * 反向依赖底线：本 lib 不 import 任何 `@/`（apps/api/src）路径。两处跨层能力
 * （事后风险缓存清理、在线监控踢人）见 `auth.ports.ts`，绑定跟随实现所在层
 * （libs/security 的 SecurityRiskModule / app 的 AppMonitorUserSharedModule）。
 */
export * from './auth.module'
export * from './auth.ports'
export * from './auth.service'

export * from './dto/auth.dto'
export * from './dto/identity.dto'

export * from './modules/cookie/cookie.module'
export * from './modules/cookie/cookie.service'

export * from './modules/google/google.dto'
export * from './modules/google/google.module'
export * from './modules/google/google.service'
export * from './modules/google/google.strategy'

export * from './modules/jwt/jwt-access.guard'
export * from './modules/jwt/jwt-access.strategy'

export * from './modules/mfa/mfa.dto'
export * from './modules/mfa/mfa.module'
export * from './modules/mfa/mfa.post.service'
export * from './modules/mfa/mfa.service'

export * from './modules/oauth/gitee/gitee.module'
export * from './modules/oauth/gitee/gitee.service'
export * from './modules/oauth/gitee/gitee.strategy'
export * from './modules/oauth/github/github.module'
export * from './modules/oauth/github/github.service'
export * from './modules/oauth/github/github.strategy'
export * from './modules/oauth/shared/oauth-state.module'
export * from './modules/oauth/shared/oauth-state.service'

export * from './modules/opaque/admin/opaque.admin.module'
export * from './modules/opaque/admin/opaque.admin.service'
export * from './modules/opaque/core/opaque.core.module'
export * from './modules/opaque/core/opaque.core.service'
export * from './modules/opaque/opaque.module'
export * from './modules/opaque/user/opaque.user.module'
export * from './modules/opaque/user/opaque.user.service'
export * from './modules/opaque/user/opaque.user.strategy'

export * from './modules/otp/const/otp.const'
export * from './modules/otp/dto/otp.dto'
export * from './modules/otp/guard/otp-functional.guard'
export * from './modules/otp/guard/otp-throttle.const'
export * from './modules/otp/guard/otp-throttle.guard'
export * from './modules/otp/otp.module'
export * from './modules/otp/otp.service'
export * from './modules/otp/otp.setting.service'
export * from './modules/otp/otp.strategy'
export * from './modules/otp/shared/otp.shared.module'
export * from './modules/otp/shared/otp.shared.service'

export * from './modules/refresh/entity/refresh-token.entity'
export * from './modules/refresh/refresh.module'
export * from './modules/refresh/refresh.recoverable'
export * from './modules/refresh/refresh.strategy'
export * from './modules/refresh/repo/refresh.pg.purge.service'
export * from './modules/refresh/repo/refresh.repo.module'
export * from './modules/refresh/repo/refresh.repo.service'
export * from './modules/refresh/shared/refresh.shared.module'
export * from './modules/refresh/shared/refresh.shared.service'

export * from './modules/session/session.module'
export * from './modules/session/session.service'

export * from './modules/shared/shared.module'
export * from './modules/shared/shared.service'
export * from './modules/shared/welcome/welcome.module'
export * from './modules/shared/welcome/welcome.service'

export * from './modules/signout/signout.module'
export * from './modules/signout/signout.service'

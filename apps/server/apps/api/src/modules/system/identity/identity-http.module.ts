import { Module } from '@nestjs/common'
import { AuthCookieModule } from '@walnut-server/auth'
import { SysIdentityModule } from '@walnut-server/identity'
import { SysUserMfaTotpController } from './mfa/totp.controller'
import { SysUserMfaWebauthnController } from './mfa/webauthn.controller'
import { SysUserController } from './user.controller'
import { SysUserMeController } from './user.me.controller'
import { SysUserDeviceController } from './user_device.controller'
import { SysUserIdentityController } from './user_identity.controller'
import { SysUserLockController } from './user_lock.controller'
import { SysUserOauthController } from './user_oauth.controller'
import { SysUserPreferenceController } from './user_preference.controller'

/**
 * 身份栈的 HTTP 组合根（libs 解耦批 6）。
 *
 * 为什么 controller 不在 libs/identity：它们依赖 app 的 guard / param decorator
 * （LockFree / MFAFree / HasPermission / DecoratorUser…）与 auth 的 AuthCookieService，
 * 放进 lib 会形成 lib → app 的反向依赖。与批 5 的 rsa 同款处置：数据面/服务下沉 lib，
 * controller 留 app 声明。路由前缀（@Controller('system/user/...')）随文件原样搬移，
 * openapi 零 diff。
 *
 * 控制器顺序与解耦前 system.module 的子模块顺序一致（user → device → identity →
 * lock → mfa → oauth → preference），swagger 的路径装配顺序不变。
 */
@Module({
  imports: [
    SysIdentityModule,
    // totp / webauthn verify 轮换 RT 后回种 RT_JTI cookie（revoke-and-insert，
    // 2026-10-27 —— 旧 jti 行已撤销，不回种新 jti 会话即断）。controller 的注入面。
    AuthCookieModule,
  ],
  controllers: [
    SysUserController,
    SysUserMeController,
    SysUserDeviceController,
    SysUserIdentityController,
    SysUserLockController,
    SysUserMfaTotpController,
    SysUserMfaWebauthnController,
    SysUserOauthController,
    SysUserPreferenceController,
  ],
})
export class SysIdentityHttpModule {}

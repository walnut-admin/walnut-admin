import { Module } from '@nestjs/common'
import { sysIdentityRecoverableRegistrarProvider } from './recoverable'
import { SysUserModule } from './user/user.module'
import { SysUserDeviceModule } from './user_device/user_device.module'
import { SysUserIdentityModule } from './user_identity/user_identity.module'
import { SysUserLockModule } from './user_lock/user_lock.module'
import { SysUserMfaModule } from './user_mfa/user_mfa.module'
import { SysUserOauthModule } from './user_oauth/user_oauth.module'
import { SysUserPreferenceModule } from './user_preference/user_preference.module'

/**
 * 身份内核的聚合模块（libs 解耦批 6）。
 *
 * `system.module.ts` 只 import 本聚合 —— 七个身份栈子模块的接入顺序与解耦前
 * 完全一致（user → device → identity → lock → mfa → oauth → preference）。
 *
 * 说明：**controller 不在内核里**。身份栈的 9 个 controller 依赖 app 的 guard /
 * param decorator（LockFree / MFAFree / HasPermission / DecoratorUser…）与 auth 的
 * AuthCookieService，放进 lib 会立刻形成 lib → app 反向依赖（批 5 的 rsa 同款处置：
 * service + module 下沉、controller 留 app）。它们由 app 的
 * `apps/api/src/modules/system/identity/identity-http.module.ts` 声明。
 */
@Module({
  imports: [
    SysUserModule,
    SysUserDeviceModule,
    SysUserIdentityModule,
    SysUserLockModule,
    SysUserMfaModule,
    SysUserOauthModule,
    SysUserPreferenceModule,
  ],
  exports: [
    SysUserModule,
    SysUserDeviceModule,
    SysUserIdentityModule,
    SysUserLockModule,
    SysUserMfaModule,
    SysUserOauthModule,
    SysUserPreferenceModule,
  ],
  // 批 7：回收站恢复器登记（登记制 —— 回收站不再 import identity 实体清单）
  providers: [sysIdentityRecoverableRegistrarProvider],
})
export class SysIdentityModule {}

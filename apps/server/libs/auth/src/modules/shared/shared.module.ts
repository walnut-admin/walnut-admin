import { Module } from '@nestjs/common'
import { SysUserDeviceSharedModule, SysUserLockModule, SysUserSharedModule } from '@walnut-server/identity'
import { AuthCookieModule } from '../cookie/cookie.module'
import { AuthRefreshSharedModule } from '../refresh/shared/refresh.shared.module'
import { AuthSharedService } from './shared.service'
import { SharedWelcomeModule } from './welcome/welcome.module'

// L1（2026-11-27）：登录漏斗挂「方案② 登录即解锁」—— AuthSharedService 注入
// SysUserLockService（identity 的锁屏域服务）。identity 不反向依赖 auth，无环。
const sharedModules = [AuthCookieModule, SysUserDeviceSharedModule, SysUserSharedModule, SysUserLockModule, SharedWelcomeModule]

@Module({
  imports: [...sharedModules, AuthRefreshSharedModule],
  providers: [AuthSharedService],
  exports: [AuthSharedService, ...sharedModules],
})
export class AuthSharedModule {}

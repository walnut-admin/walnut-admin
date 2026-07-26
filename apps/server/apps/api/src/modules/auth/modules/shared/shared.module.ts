import { Module } from '@nestjs/common'
import { SharedWelcomeModule } from '@/modules/shared/welcome/welcome.module'
import { SysUserSharedModule } from '@/modules/system/user/shared/user.shared.module'
import { SysUserDeviceSharedModule } from '@/modules/system/user_device/shared/user_device.shared.module'
import { AuthCookieModule } from '../cookie/cookie.module'
import { AuthRefreshSharedModule } from '../refresh/shared/refresh.shared.module'
import { AuthSharedService } from './shared.service'

const sharedModules = [AuthCookieModule, SysUserDeviceSharedModule, SysUserSharedModule, SharedWelcomeModule]

@Module({
  imports: [...sharedModules, AuthRefreshSharedModule],
  providers: [AuthSharedService],
  exports: [AuthSharedService, ...sharedModules],
})
export class AuthSharedModule {}

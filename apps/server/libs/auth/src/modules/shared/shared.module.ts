import { Module } from '@nestjs/common'
import { SysUserDeviceSharedModule, SysUserSharedModule } from '@walnut-server/identity'
import { AuthCookieModule } from '../cookie/cookie.module'
import { AuthRefreshSharedModule } from '../refresh/shared/refresh.shared.module'
import { AuthSharedService } from './shared.service'
import { SharedWelcomeModule } from './welcome/welcome.module'

const sharedModules = [AuthCookieModule, SysUserDeviceSharedModule, SysUserSharedModule, SharedWelcomeModule]

@Module({
  imports: [...sharedModules, AuthRefreshSharedModule],
  providers: [AuthSharedService],
  exports: [AuthSharedService, ...sharedModules],
})
export class AuthSharedModule {}

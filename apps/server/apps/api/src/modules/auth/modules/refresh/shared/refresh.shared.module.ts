import { Module } from '@nestjs/common'
import { SysUserSharedModule } from '@/modules/system/user/shared/user.shared.module'
import { SysUserDeviceSharedModule } from '@/modules/system/user_device/shared/user_device.shared.module'
import { AuthSessionModule } from '../../session/session.module'
import { AuthRefreshSharedService } from './refresh.shared.service'

@Module({
  imports: [
    AuthSessionModule,
    SysUserDeviceSharedModule,
    SysUserSharedModule,
  ],
  controllers: [],
  providers: [AuthRefreshSharedService],
  exports: [AuthRefreshSharedService],
})
export class AuthRefreshSharedModule { }

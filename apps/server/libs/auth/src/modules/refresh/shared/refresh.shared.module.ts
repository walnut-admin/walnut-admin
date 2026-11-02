import { Module } from '@nestjs/common'
import { SysUserDeviceSharedModule, SysUserSharedModule } from '@walnut-server/identity'
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

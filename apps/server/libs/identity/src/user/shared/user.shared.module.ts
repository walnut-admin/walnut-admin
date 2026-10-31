import { Module } from '@nestjs/common'
import { SharedScopeResolverModule } from '@walnut-server/scope-resolver'
import { AppTokenModule } from '@walnut-server/token'
import { SysUserDeviceSharedModule } from '../../user_device/shared/user_device.shared.module'
import { SysUserRepositoryModule } from '../repo/user.repo.module'
import { SysUserSharedService } from './user.shared.service'

@Module({
  imports: [
    SharedScopeResolverModule,
    SysUserDeviceSharedModule,
    AppTokenModule,
    SysUserRepositoryModule,
  ],
  controllers: [],
  providers: [SysUserSharedService],
  exports: [SysUserSharedService],
})
export class SysUserSharedModule { }

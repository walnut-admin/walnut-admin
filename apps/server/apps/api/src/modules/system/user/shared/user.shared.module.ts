import { Module } from '@nestjs/common'
import { SharedScopeResolverModule } from '@/modules/shared/scopeResolver/scope-resolver.module'
import { AppTokenModule } from '@/modules/shared/token/token.module'
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

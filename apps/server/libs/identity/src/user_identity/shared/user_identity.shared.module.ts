import { Module } from '@nestjs/common'

import { SysUserRepositoryModule } from '../../user/repo/user.repo.module'

import { SysUserIdentityRepositoryModule } from '../repo/user_identity.repo.module'
import { SysUserIdentitySharedService } from './user_identity.shared.service'

@Module({
  imports: [
    SysUserIdentityRepositoryModule,
    SysUserRepositoryModule,
  ],
  providers: [SysUserIdentitySharedService],
  exports: [SysUserIdentitySharedService],
})
export class SysUserIdentitySharedModule {}

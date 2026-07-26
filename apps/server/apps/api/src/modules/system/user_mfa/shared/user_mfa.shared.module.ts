import { Module } from '@nestjs/common'
import { SysUserRepositoryModule } from '../../user/repo/user.repo.module'
import { SysUserMfaRepositoryModule } from '../repo/user_mfa.repo.module'
import { SysUserMfaSharedService } from './user_mfa.shared.service'

@Module({
  imports: [
    SysUserRepositoryModule,
    SysUserMfaRepositoryModule,
  ],
  controllers: [],
  providers: [SysUserMfaSharedService],
  exports: [SysUserMfaSharedService],
})
export class SysUserMfaSharedModule {}

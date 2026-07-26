import { Module } from '@nestjs/common'

import { OtpSharedModule } from '@/modules/auth/modules/otp/shared/otp.shared.module'
import { SysUserRepositoryModule } from '@/modules/system/user/repo/user.repo.module'

import { SysUserIdentityRepositoryModule } from '../repo/user_identity.repo.module'
import { SysUserIdentitySharedService } from './user_identity.shared.service'

@Module({
  imports: [
    SysUserIdentityRepositoryModule,
    SysUserRepositoryModule,
    OtpSharedModule,
  ],
  providers: [SysUserIdentitySharedService],
  exports: [SysUserIdentitySharedService],
})
export class SysUserIdentitySharedModule {}

import { Global, Module } from '@nestjs/common'

import { OtpSharedModule } from '@/modules/auth/modules/otp/shared/otp.shared.module'
import { SysUserIdentitySharedModule } from '@/modules/system/user_identity/shared/user_identity.shared.module'

import { SecuritySensitiveController } from './sensitive.controller'
import { SecuritySensitiveService } from './sensitive.service'

@Global()
@Module({
  imports: [
    SysUserIdentitySharedModule,
    OtpSharedModule,
  ],
  controllers: [SecuritySensitiveController],
  providers: [SecuritySensitiveService],
  exports: [SecuritySensitiveService],
})
export class SecuritySensitiveModule {}

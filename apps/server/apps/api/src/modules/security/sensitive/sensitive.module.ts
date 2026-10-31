import { Global, Module } from '@nestjs/common'

import { SysUserIdentitySharedModule } from '@walnut-server/identity'
import { OtpSharedModule } from '@/modules/auth/modules/otp/shared/otp.shared.module'

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

import { Global, Module } from '@nestjs/common'

import { OtpSharedModule } from '@walnut-server/auth'
import { SysUserIdentitySharedModule } from '@walnut-server/identity'

import { SecuritySensitiveService } from './sensitive.service'

@Global()
@Module({
  imports: [
    SysUserIdentitySharedModule,
    OtpSharedModule,
  ],
  providers: [SecuritySensitiveService],
  exports: [SecuritySensitiveService],
})
export class SecuritySensitiveModule {}

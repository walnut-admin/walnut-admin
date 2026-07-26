import { Module } from '@nestjs/common'
import { SysUserDeviceSharedModule } from '@/modules/system/user_device/shared/user_device.shared.module'
import { SysUserMfaSharedModule } from '@/modules/system/user_mfa/shared/user_mfa.shared.module'
import { AuthRefreshSharedModule } from '../refresh/shared/refresh.shared.module'
import { AuthSharedModule } from '../shared/shared.module'
import { AuthMfaController } from './mfa.controller'
import { AuthMfaPostVerificationService } from './mfa.post.service'
import { AuthMfaService } from './mfa.service'

@Module({
  imports: [AuthSharedModule, SysUserMfaSharedModule, AuthRefreshSharedModule, SysUserDeviceSharedModule, SysUserMfaSharedModule],
  controllers: [AuthMfaController],
  providers: [AuthMfaService, AuthMfaPostVerificationService],
  exports: [AuthMfaService, AuthMfaPostVerificationService],
})
export class AuthMfaModule {}

import { Module } from '@nestjs/common'
import { SysUserIdentitySharedModule } from '@walnut-server/identity'
import { AuthSharedModule } from '../shared/shared.module'
import { OtpService } from './otp.service'
import { OtpSettingService } from './otp.setting.service'
import { OtpStrategy } from './otp.strategy'
import { OtpSharedModule } from './shared/otp.shared.module'

@Module({
  imports: [
    OtpSharedModule,
    AuthSharedModule,
    SysUserIdentitySharedModule,
  ],
  providers: [
    OtpService,
    OtpStrategy,
    OtpSettingService,
  ],
  exports: [OtpService, OtpSettingService],
})
export class OtpModule {}

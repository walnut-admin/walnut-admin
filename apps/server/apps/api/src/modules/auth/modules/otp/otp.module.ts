import { Module } from '@nestjs/common'
import { SysUserIdentitySharedModule } from '@/modules/system/user_identity/shared/user_identity.shared.module'
import { AuthSharedModule } from '../shared/shared.module'
import { OtpFunctionalGuard, OtpSendFunctionalGuard } from './guard/otp-functional.guard'
import { OtpThrottleGuard } from './guard/otp-throttle.guard'
import { OtpController } from './otp.controller'
import { OtpGuard } from './otp.guard'
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
  controllers: [OtpController],
  providers: [
    OtpService,
    OtpStrategy,
    OtpGuard,
    OtpSettingService,
    OtpFunctionalGuard,
    OtpSendFunctionalGuard,
    OtpThrottleGuard,
  ],
  exports: [OtpService, OtpSettingService],
})
export class OtpModule {}

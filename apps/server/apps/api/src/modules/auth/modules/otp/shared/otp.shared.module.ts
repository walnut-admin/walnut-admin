import { Module } from '@nestjs/common'
import { AppMailerModule } from '@walnut-server/mailer'
import { AliyunSmsModule, AppSmsModule } from '@walnut-server/sms'
import { OtpSettingService } from '../otp.setting.service'
import { OtpSharedService } from './otp.shared.service'

@Module({
  imports: [
    AppMailerModule,
    AppSmsModule,
    AliyunSmsModule,
  ],
  providers: [OtpSharedService, OtpSettingService],
  exports: [OtpSharedService, OtpSettingService],
})
export class OtpSharedModule {}

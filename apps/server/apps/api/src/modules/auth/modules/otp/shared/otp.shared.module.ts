import { Module } from '@nestjs/common'
import { AppMailerModule } from '@/modules/shared/mailer/mailer.module'
import { AliyunSmsModule } from '@/modules/shared/sms/aliyun/aliyun.sms.module'
import { AppSmsModule } from '@/modules/shared/sms/sms.module'
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

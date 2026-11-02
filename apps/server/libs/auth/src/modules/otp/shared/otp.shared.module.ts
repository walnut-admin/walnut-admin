import { Global, Module } from '@nestjs/common'
import { WALNUT_ADMIN_IDENTITY_OTP_SERVICE } from '@walnut-server/identity'
import { AppMailerModule } from '@walnut-server/mailer'
import { AliyunSmsModule, AppSmsModule } from '@walnut-server/sms'
import { OtpSettingService } from '../otp.setting.service'
import { OtpSharedService } from './otp.shared.service'

/**
 * @Global：批 6 起 libs/identity 的 user_identity 服务只认
 * WALNUT_ADMIN_IDENTITY_OTP_SERVICE 端口（@Inject 注入，不 import 本模块）；
 * 本模块（@Global）绑定实现，全局可见。
 */
@Global()
@Module({
  imports: [
    AppMailerModule,
    AppSmsModule,
    AliyunSmsModule,
  ],
  providers: [
    OtpSharedService,
    OtpSettingService,
    {
      provide: WALNUT_ADMIN_IDENTITY_OTP_SERVICE,
      useExisting: OtpSharedService,
    },
  ],
  exports: [OtpSharedService, OtpSettingService, WALNUT_ADMIN_IDENTITY_OTP_SERVICE],
})
export class OtpSharedModule {}

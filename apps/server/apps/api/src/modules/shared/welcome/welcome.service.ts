import type { IWalnutAdminConstAppLanguage } from '@walnut-server/const/app/lang'
import type { IOtpType } from '@/modules/auth/modules/otp/const/otp.const'
import { Injectable, Logger } from '@nestjs/common'
import { AppMailerService } from '../mailer/mailer.service'
import { AppSmsService } from '../sms/sms.service'

@Injectable()
export class SharedWelcomeService {
  private readonly logger = new Logger(SharedWelcomeService.name)

  constructor(private readonly mailerService: AppMailerService, private readonly smsService: AppSmsService) { }

  /**
   * @description send welcome message to user by type (email/sms)
   */
  async sendWelcomeByType(type: IOtpType, identifier: string, language: IWalnutAdminConstAppLanguage) {
    if (type === 'email') {
      const res = await this.mailerService.sendWelcomeEmail(identifier, language)
      this.logger.log(`send welcome email to ${identifier} result: ${res}`)
    }
    else if (type === 'sms') {
      const res = await this.smsService.sendWelcomeTextMessage(identifier, language)
      this.logger.log(`send welcome sms to ${identifier} result: ${res}`)
    }
  }
}

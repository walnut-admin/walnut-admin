import { MailerService } from '@nestjs-modules/mailer'
import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { WalnutAdminConstAppProcess } from '@walnut/const/app/process'
import { WalnutAdminConstAppQueue } from '@walnut/const/app/queue'
import { WalnutAdminExceptionBadRequest } from '@walnut/exceptions/base.exception'

import { Job } from 'bull'
import { Recordable } from 'easy-fns-ts'
import { I18nService } from 'nestjs-i18n'
import { WalnutAdminCommonBasicProcessor } from '@/common/processor/base.processor'

@Processor(WalnutAdminConstAppQueue.EMAIL)
export class AppMailerProcessor extends WalnutAdminCommonBasicProcessor {
  protected readonly logger = new Logger(AppMailerProcessor.name)

  constructor(
    private readonly mailerService: MailerService,
    private readonly i18nService: I18nService<Recordable>,
  ) {
    super()
  }

  // send welcome email
  @Process(WalnutAdminConstAppProcess.EMAIL_WELCOME)
  async JobSendWelcomeEmail(job: Job<{ toEmail: string, lang: string }>) {
    const { toEmail, lang } = job.data

    try {
      await this.mailerService.sendMail({
        to: toEmail,
        subject: this.i18nService.t('email.welcome.subject', { lang }),
        template: 'welcome',
        context: {
          title: this.i18nService.t('email.welcome.title', { lang }),
          desc1: this.i18nService.t('email.welcome.desc1', { lang }),
          desc2: this.i18nService.t('email.welcome.desc2', { lang }),
          here: this.i18nService.t('email.welcome.here', { lang }),
          lang,
        },
      })
      this.logger.log(`send welcome email to ${toEmail}`)
    }
    catch (error) {
      this.logger.error(error)
      return false
    }

    return true
  }

  // send verify code email
  @Process(WalnutAdminConstAppProcess.EMAIL_VERIFY)
  async JobSendVerifyCodeEmail(job: Job<{ toEmail: string, verifyCode: string, expireSeconds: number, lang: string }>) {
    const { toEmail, verifyCode, expireSeconds, lang } = job.data

    try {
      await this.mailerService.sendMail({
        to: toEmail,
        subject: this.i18nService.t('email.verify.subject', { lang }),
        template: 'verify',
        context: {
          title: this.i18nService.t('email.verify.title', { lang }),
          desc1: this.i18nService.t('email.verify.desc1', { lang }),
          desc2: this.i18nService.t('email.verify.desc2', { lang }),
          desc3: this.i18nService.t('email.verify.desc3', {
            lang,
            args: { min: Math.floor(expireSeconds / 60) },
          }),
          verifyCode,
          lang,
        },
      })
      this.logger.log(`send verify code email to ${toEmail}`)
    }
    catch (error) {
      this.logger.error(error)
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.sendVerifyCodeError' })
    }

    return true
  }
}

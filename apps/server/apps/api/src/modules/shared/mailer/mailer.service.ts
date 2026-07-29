import { InjectQueue } from '@nestjs/bull'
import { Injectable } from '@nestjs/common'

import { LocaleType, LocaleType } from '@walnut/contract'
import { WalnutAdminConstAppProcess } from '@walnut-server/const/app/process'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { Queue } from 'bull'
import { isNil } from 'lodash'

@Injectable()
export class AppMailerService {
  constructor(
    @InjectQueue(WalnutAdminConstAppQueue.EMAIL) private readonly emailQueue: Queue,
  ) {}

  // send welcome email
  async sendWelcomeEmail(toEmail: string | string[], lang: LocaleType) {
    if (isNil(toEmail) || toEmail.length === 0)
      return

    // push to queue
    await this.emailQueue.add(
      WalnutAdminConstAppProcess.EMAIL_WELCOME,
      {
        toEmail,
        lang,
      },
      { removeOnComplete: true, removeOnFail: true, attempts: 3, priority: 10 },
    )

    return true
  }

  // send verify code email
  async sendVerifyCodeEmail(
    toEmail: string,
    verifyCode: number,
    expireSeconds: number,
    lang: LocaleType,
  ) {
    // push to queue
    await this.emailQueue.add(
      WalnutAdminConstAppProcess.EMAIL_VERIFY,
      {
        toEmail,
        verifyCode,
        expireSeconds,
        lang,
      },
      { removeOnComplete: true, removeOnFail: true, attempts: 3, priority: 10 },
    )

    return true
  }
}

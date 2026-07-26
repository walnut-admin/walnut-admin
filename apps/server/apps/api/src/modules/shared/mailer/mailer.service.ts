import { InjectQueue } from '@nestjs/bull'
import { Injectable } from '@nestjs/common'

import { IWalnutAdminConstAppLanguage } from '@walnut/const/app/lang'
import { WalnutAdminConstAppProcess } from '@walnut/const/app/process'
import { WalnutAdminConstAppQueue } from '@walnut/const/app/queue'
import { Queue } from 'bull'
import { isNil } from 'lodash'

@Injectable()
export class AppMailerService {
  constructor(
    @InjectQueue(WalnutAdminConstAppQueue.EMAIL) private readonly emailQueue: Queue,
  ) {}

  // send welcome email
  async sendWelcomeEmail(toEmail: string | string[], lang: IWalnutAdminConstAppLanguage) {
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
    lang: IWalnutAdminConstAppLanguage,
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

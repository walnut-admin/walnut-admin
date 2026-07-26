import { InjectQueue } from '@nestjs/bull'
import { Injectable } from '@nestjs/common'

import { IWalnutAdminConstAppLanguage } from '@walnut-server/const/app/lang'
import { WalnutAdminConstAppProcess } from '@walnut-server/const/app/process'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { Queue } from 'bull'
import { isNil } from 'lodash'

@Injectable()
export class AppSmsService {
  constructor(
    @InjectQueue(WalnutAdminConstAppQueue.PHONE)
    private readonly smsQueue: Queue,
  ) {}

  // send welcome email
  async sendWelcomeTextMessage(phoneNumber: string | string[], lang: IWalnutAdminConstAppLanguage) {
    if (isNil(phoneNumber))
      return

    // push to queue
    await this.smsQueue.add(
      WalnutAdminConstAppProcess.PHONE_WELCOME,
      {
        phoneNumber,
        lang,
      },
      { removeOnComplete: true, removeOnFail: true, attempts: 3, priority: 10 },
    )

    return true
  }

  // send verify code text message
  async sendVerifyCodeTextMessage(
    phoneNumber: string,
    verifyCode: number,
    expireSeconds: number,
    lang: IWalnutAdminConstAppLanguage,
  ) {
    if (!phoneNumber)
      return

    // push to queue
    await this.smsQueue.add(
      WalnutAdminConstAppProcess.PHONE_VERIFY,
      {
        phoneNumber,
        verifyCode,
        expireSeconds,
        lang,
      },
      { removeOnComplete: true, removeOnFail: true, attempts: 3, priority: 10 },
    )

    return true
  }
}

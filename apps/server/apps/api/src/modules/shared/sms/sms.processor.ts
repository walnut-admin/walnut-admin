import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { WalnutAdminConstAppProcess } from '@walnut-server/const/app/process'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { Job } from 'bull'
import { isNil } from 'lodash'
import { WalnutAdminCommonBasicProcessor } from '@/common/processor/base.processor'

import { AppTechCacheVerifyCodeService } from '@/modules/techniques/cache/service/cache.verifyCode'
import { AliyunSmsService } from './aliyun/aliyun.sms.service'

@Processor(WalnutAdminConstAppQueue.PHONE)
export class AppSmsProcessor extends WalnutAdminCommonBasicProcessor {
  protected readonly logger = new Logger(this.constructor.name)

  constructor(
    private readonly aliyunSmsService: AliyunSmsService,
    private readonly cacheVerifyCodeService: AppTechCacheVerifyCodeService,
  ) {
    super()
  }

  // TODO send welcome text message
  @Process(WalnutAdminConstAppProcess.PHONE_WELCOME)
  async JobSendWelcomeTextMessage(job: Job<{ phoneNumber: string }>) {
    const { phoneNumber } = job.data

    this.logger.log(phoneNumber)
  }

  // send verify code text message via Aliyun
  @Process(WalnutAdminConstAppProcess.PHONE_VERIFY)
  async JobSendVerifyCodeTextMessage(job: Job<{ phoneNumber: string, verifyCode: string, expireSeconds: number }>) {
    const { phoneNumber, expireSeconds } = job.data

    try {
      const result = await this.aliyunSmsService.sendVerificationCode({
        phoneNumber,
        templateCode: 'SIGN_IN_OR_SIGN_UP',
        validTime: Math.floor(expireSeconds / 60),
      })

      if (result.success) {
        this.logger.log(`SMS sent to ${phoneNumber}, BizId: ${result.BizId}`)

        // Save bizId to cache for later verification
        if (!isNil(result.BizId)) {
          await this.cacheVerifyCodeService.setAliyunSmsBizIdForVisitorCache(
            phoneNumber,
            result.BizId,
            expireSeconds,
          )
        }

        return true
      }
      else {
        throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.sendVerifyCodeError' })
      }
    }
    catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger.error(`SMS send failed: ${err.message}`, err.stack)
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.sendVerifyCodeError' })
    }
  }
}

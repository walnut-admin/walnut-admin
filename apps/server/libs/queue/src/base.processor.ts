import { OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'

export abstract class WalnutAdminCommonBasicProcessor {
  protected logger: Logger

  constructor() {}

  @OnQueueActive()
  onActive(job: Job) {
    // F-06：**不要**打 job.data —— EMAIL_VERIFY / PHONE_VERIFY 的 data 携带验证码原文
    // （mailer.service / sms.service 的入队载荷 { toEmail|phoneNumber, verifyCode, ... }），
    // 日志落盘后 OTP 爆破面从「猜 6 位数」退化为「读日志」。jobId + name 足以排障。
    this.logger.log(`Processing job ${job.id} of type ${job.name}`)
  }

  @OnQueueCompleted()
  onComplete(job: Job, result: any) {
    this.logger.log(
      `Completed job ${job.id} of type ${job.name}. Result: ${JSON.stringify(
        result,
      )}`,
    )
  }

  @OnQueueFailed()
  onError(job: Job<any>, error: any) {
    this.logger.error(
      `Failed job ${job.id} of type ${job.name}`,
      error,
    )
  }
}

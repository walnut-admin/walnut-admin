import { InjectQueue } from '@nestjs/bull'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

import { WalnutAdminConstAppProcess } from '@walnut-server/const/app/process'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { LocaleType } from '@walnut/contract'
import { Job, Queue } from 'bull'
import { isNil } from 'lodash'

@Injectable()
export class AppMailerService implements OnModuleInit {
  private readonly logger = new Logger(AppMailerService.name)

  constructor(
    @InjectQueue(WalnutAdminConstAppQueue.EMAIL) private readonly emailQueue: Queue,
  ) {}

  /**
   * F-29（CQ-014）：验证码投递失败必须可观测。
   *
   * 入队是 fire-and-forget（HTTP 早已 200，用户侧只看到「等验证码」），而验证码任务此前
   * 是 `removeOnFail: true` + 无失败日志 —— 3 次重试失败后 job 被直接删掉，既无死信也
   * 无痕迹。两处配套修复：
   * - 入队选项改为 `removeOnFail: false`（见 sendVerifyCodeEmail）：job 本体留在 Bull 的
   *   failed 集合里，可人工读取/重放；
   * - 本方法订阅队列的 `failed` 事件补一条错误日志（零新增依赖，bull 自带事件）。
   *
   * 日志只打 jobId / name / 已重试次数 / 错误摘要：`job.data` 带验证码原文与收件地址，
   * 落盘等于把 OTP 爆破面从「猜 6 位数」退化成「读日志」（F-06 同口径）。
   */
  onModuleInit() {
    this.emailQueue.on('failed', (job: Job, error: Error) => {
      this.logger.error(
        `[Mailer] job ${job.id} (${job.name}) failed after ${job.attemptsMade} attempt(s); payload kept in failed set: ${errorMessage(error)}`,
      )
    })
  }

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
      // 欢迎邮件是「锦上添花」：失败即丢，不占 failed 集合（F-29 只收验证码类任务）
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
      // F-29：验证码是登录/敏感操作的必经路径 —— 失败必须留现场（failed 集合 + failed
      // 事件日志），不能随 removeOnFail 一起被删掉
      { removeOnComplete: true, removeOnFail: false, attempts: 3, priority: 10 },
    )

    return true
  }
}

/** 错误摘要（不打 job.data：验证码 / 收件地址不进日志） */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

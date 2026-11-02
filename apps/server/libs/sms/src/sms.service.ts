import { InjectQueue } from '@nestjs/bull'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

import { WalnutAdminConstAppProcess } from '@walnut-server/const/app/process'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { LocaleType } from '@walnut/contract'
import { Job, Queue } from 'bull'
import { isNil } from 'lodash'

@Injectable()
export class AppSmsService implements OnModuleInit {
  private readonly logger = new Logger(AppSmsService.name)

  constructor(
    @InjectQueue(WalnutAdminConstAppQueue.PHONE)
    private readonly smsQueue: Queue,
  ) {}

  /**
   * F-29（CQ-014）：验证码短信投递失败必须可观测。
   *
   * 入队是 fire-and-forget（HTTP 早已 200），而验证码任务此前是 `removeOnFail: true`
   * + 无失败日志 —— 3 次重试失败后 job 被删掉，用户收不到短信且服务端无痕迹。两处配套：
   * - 入队选项改 `removeOnFail: false`（见 sendVerifyCodeTextMessage）：job 留在 Bull 的
   *   failed 集合里可排查/重放；
   * - 本方法订阅队列 `failed` 事件补错误日志（零新增依赖）。
   *
   * 日志只打 jobId / name / 已重试次数 / 错误摘要：`job.data` 带验证码与手机号，
   * 落盘等于把 OTP 爆破面从「猜 6 位数」退化成「读日志」（F-06 同口径）。
   */
  onModuleInit() {
    this.smsQueue.on('failed', (job: Job, error: Error) => {
      this.logger.error(
        `[Sms] job ${job.id} (${job.name}) failed after ${job.attemptsMade} attempt(s); payload kept in failed set: ${errorMessage(error)}`,
      )
    })
  }

  // send welcome email
  async sendWelcomeTextMessage(phoneNumber: string | string[], lang: LocaleType) {
    if (isNil(phoneNumber))
      return

    // push to queue
    await this.smsQueue.add(
      WalnutAdminConstAppProcess.PHONE_WELCOME,
      {
        phoneNumber,
        lang,
      },
      // 欢迎短信失败即丢（F-29 只收验证码类任务）
      { removeOnComplete: true, removeOnFail: true, attempts: 3, priority: 10 },
    )

    return true
  }

  // send verify code text message
  async sendVerifyCodeTextMessage(
    phoneNumber: string,
    verifyCode: number,
    expireSeconds: number,
    lang: LocaleType,
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
      // F-29：验证码短信是登录/敏感操作的必经路径 —— 失败保留 job（failed 集合）+
      // failed 事件日志，不再随 removeOnFail 一起被删
      { removeOnComplete: true, removeOnFail: false, attempts: 3, priority: 10 },
    )

    return true
  }
}

/** 错误摘要（不打 job.data：验证码 / 手机号不进日志） */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

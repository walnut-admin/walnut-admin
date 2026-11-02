import type { Queue } from 'bull'
import { Logger } from '@nestjs/common'
import { WalnutAdminConstAppProcess } from '@walnut-server/const/app/process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppMailerService } from './mailer.service'

/**
 * F-29（CQ-014）：验证码投递失败不可观测 —— 入队是 fire-and-forget，而验证码任务此前
 * `removeOnFail: true` 且无失败日志：3 次重试后 job 被删，用户收不到验证码且服务端没痕迹。
 *
 * 本用例钉两件事（不新增依赖，靠 bull 自带的 failed 事件）：
 * 1. 入队选项：验证码任务 removeOnFail=false（保留现场），欢迎邮件维持 true；
 * 2. failed 事件记日志，且日志里**没有**验证码原文/收件地址（F-06 同口径）。
 */

function createService() {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const add = vi.fn(async (..._args: unknown[]) => ({ id: '1' }))
  const queue: Queue = {
    add,
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener)
      return queue
    }),
  } as unknown as Queue

  return { service: new AppMailerService(queue), add, listeners }
}

function queueOptionsOf(add: ReturnType<typeof vi.fn>) {
  return add.mock.calls[0][2] as Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mailer service：验证码任务失败留痕（F-29）', () => {
  it('sendVerifyCodeEmail：removeOnFail=false（job 保留在 failed 集合）', async () => {
    const { service, add } = createService()

    await service.sendVerifyCodeEmail('alice@example.com', 654321, 300, 'zh_CN')

    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][0]).toBe(WalnutAdminConstAppProcess.EMAIL_VERIFY)
    expect(queueOptionsOf(add)).toMatchObject({
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
    })
  })

  it('sendWelcomeEmail：非验证码任务维持 removeOnFail=true（不占 failed 集合）', async () => {
    const { service, add } = createService()

    await service.sendWelcomeEmail('alice@example.com', 'zh_CN')

    expect(add.mock.calls[0][0]).toBe(WalnutAdminConstAppProcess.EMAIL_WELCOME)
    expect(queueOptionsOf(add).removeOnFail).toBe(true)
  })

  it('onModuleInit 订阅 failed 事件：失败记错误日志（含 jobId / name / 重试次数）', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const { service, listeners } = createService()

    service.onModuleInit()
    expect(listeners.has('failed')).toBe(true)

    listeners.get('failed')!({
      id: '42',
      name: WalnutAdminConstAppProcess.EMAIL_VERIFY,
      attemptsMade: 3,
      data: { toEmail: 'alice@example.com', verifyCode: 654321, expireSeconds: 300, lang: 'zh_CN' },
    }, new Error('SMTP connection refused'))

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = errorSpy.mock.calls[0][0] as string
    expect(line).toContain('42')
    expect(line).toContain(WalnutAdminConstAppProcess.EMAIL_VERIFY)
    expect(line).toContain('3 attempt')
    expect(line).toContain('SMTP connection refused')
    // job.data 带验证码原文与收件地址 —— 不允许进日志
    expect(line).not.toContain('654321')
    expect(line).not.toContain('alice@example.com')
  })
})

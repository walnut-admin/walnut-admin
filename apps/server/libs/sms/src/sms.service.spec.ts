import type { Queue } from 'bull'
import { Logger } from '@nestjs/common'
import { WalnutAdminConstAppProcess } from '@walnut-server/const/app/process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppSmsService } from './sms.service'

/**
 * F-29（CQ-014）：验证码短信投递失败不可观测 —— 入队 fire-and-forget，而验证码任务此前
 * `removeOnFail: true` 且无失败日志：3 次重试后 job 被删，用户收不到短信且服务端没痕迹。
 *
 * 与 mailer 同款两处修复，本用例钉：验证码任务 removeOnFail=false（保留现场）、
 * 欢迎短信维持 true、failed 事件记日志且日志里没有验证码/手机号。
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

  return { service: new AppSmsService(queue), add, listeners }
}

function queueOptionsOf(add: ReturnType<typeof vi.fn>) {
  return add.mock.calls[0][2] as Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sms service：验证码任务失败留痕（F-29）', () => {
  it('sendVerifyCodeTextMessage：removeOnFail=false（job 保留在 failed 集合）', async () => {
    const { service, add } = createService()

    await service.sendVerifyCodeTextMessage('13800000000', 654321, 300, 'zh_CN')

    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][0]).toBe(WalnutAdminConstAppProcess.PHONE_VERIFY)
    expect(queueOptionsOf(add)).toMatchObject({
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
    })
  })

  it('sendWelcomeTextMessage：非验证码任务维持 removeOnFail=true', async () => {
    const { service, add } = createService()

    await service.sendWelcomeTextMessage('13800000000', 'zh_CN')

    expect(add.mock.calls[0][0]).toBe(WalnutAdminConstAppProcess.PHONE_WELCOME)
    expect(queueOptionsOf(add).removeOnFail).toBe(true)
  })

  it('onModuleInit 订阅 failed 事件：失败记错误日志，且不含验证码 / 手机号', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const { service, listeners } = createService()

    service.onModuleInit()
    expect(listeners.has('failed')).toBe(true)

    listeners.get('failed')!({
      id: '43',
      name: WalnutAdminConstAppProcess.PHONE_VERIFY,
      attemptsMade: 3,
      data: { phoneNumber: '13800000000', verifyCode: 654321, expireSeconds: 300, lang: 'zh_CN' },
    }, new Error('aliyun sms signature error'))

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = errorSpy.mock.calls[0][0] as string
    expect(line).toContain('43')
    expect(line).toContain(WalnutAdminConstAppProcess.PHONE_VERIFY)
    expect(line).toContain('3 attempt')
    expect(line).toContain('aliyun sms signature error')
    expect(line).not.toContain('654321')
    expect(line).not.toContain('13800000000')
  })
})

import type { Logger } from '@nestjs/common'
import type { Job } from 'bull'
import { describe, expect, it, vi } from 'vitest'

import { WalnutAdminCommonBasicProcessor } from '../base.processor'

/** 只测 onActive 的日志口径：本基类的 logger 由子类赋值（见各 processor）。 */
class TestProcessor extends WalnutAdminCommonBasicProcessor {
  constructor(logger: Logger) {
    super()
    this.logger = logger
  }
}

function createProcessor() {
  const log = vi.fn()
  const logger = { log, error: vi.fn(), warn: vi.fn() } as unknown as Logger

  return { log, processor: new TestProcessor(logger) }
}

describe('onActive 日志脱敏（WalnutAdminCommonBasicProcessor，F-06）', () => {
  it('只打 jobId / name：PHONE_VERIFY 的验证码与手机号不进日志', () => {
    const { log, processor } = createProcessor()

    const job = {
      id: '42',
      name: 'PHONE_VERIFY',
      data: {
        phoneNumber: '13800000000',
        verifyCode: '654321',
        expireSeconds: 300,
        lang: 'zh-CN',
      },
    }

    processor.onActive(job as unknown as Job)

    expect(log).toHaveBeenCalledTimes(1)
    const line = log.mock.calls[0][0] as string
    expect(line).toContain('42')
    expect(line).toContain('PHONE_VERIFY')
    expect(line).not.toContain('654321')
    expect(line).not.toContain('13800000000')
    expect(line).not.toContain('Data:')
  })

  it('email 任务（EMAIL_VERIFY）的收件邮箱同样不进日志', () => {
    const { log, processor } = createProcessor()

    const job = {
      id: '43',
      name: 'EMAIL_VERIFY',
      data: {
        toEmail: 'alice@example.com',
        verifyCode: '112233',
        expireSeconds: 300,
        lang: 'zh-CN',
      },
    }

    processor.onActive(job as unknown as Job)

    const line = log.mock.calls[0][0] as string
    expect(line).not.toContain('alice@example.com')
    expect(line).not.toContain('112233')
  })
})

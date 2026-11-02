import type { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { fireAndForget } from './fire-and-forget'

type Loggable = Pick<Logger, 'error'>

/** 让 Node 走完 unhandledRejection 的判定窗口（判据是「本轮无人处理」） */
async function flush() {
  await new Promise<void>(resolve => setTimeout(resolve, 20))
}

/**
 * 监听 process 级 unhandledRejection —— 这是 F-05 的真正判据：
 * `void promise` 只消 lint 提示，rejection 仍会打到这里，Node 24 默认据此崩进程。
 */
function collectUnhandledRejections() {
  const reasons: unknown[] = []
  const onUnhandled = (reason: unknown) => reasons.push(reason)
  process.on('unhandledRejection', onUnhandled)

  return {
    reasons,
    restore: () => process.off('unhandledRejection', onUnhandled),
  }
}

function createLogger() {
  return { error: vi.fn() }
}

describe('fireAndForget', () => {
  it('resolve 时静默：不调 logger，也不抛', async () => {
    const logger = createLogger()

    expect(() => fireAndForget(Promise.resolve('ok'), logger, 'demo')).not.toThrow()
    await flush()

    expect(logger.error).not.toHaveBeenCalled()
  })

  it('reject 被吞：记一条 error（含 context 与 stack），且不产生 unhandledRejection', async () => {
    const logger = createLogger()
    const unhandled = collectUnhandledRejections()

    try {
      fireAndForget(Promise.reject(new Error('boom')), logger, 'welcome email')
      await flush()

      expect(logger.error).toHaveBeenCalledTimes(1)
      const [message, stack] = logger.error.mock.calls[0] as [string, string]
      expect(message).toBe('[fireAndForget] welcome email rejected')
      expect(stack).toContain('boom')
      expect(unhandled.reasons).toEqual([])
    }
    finally {
      unhandled.restore()
    }
  })

  it('省略 context 时用默认上下文，省略 logger 时静默吞掉（只保证不崩进程）', async () => {
    const logger = createLogger()
    const unhandled = collectUnhandledRejections()

    try {
      fireAndForget(Promise.reject(new Error('no context')), logger)
      fireAndForget(Promise.reject(new Error('no logger')))
      await flush()

      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.error.mock.calls[0][0]).toContain('background task')
      expect(unhandled.reasons).toEqual([])
    }
    finally {
      unhandled.restore()
    }
  })

  it('logger.error 自身抛错也不外泄（否则只是把崩点挪了个位置）', async () => {
    const logger: Loggable = {
      error: () => { throw new Error('logger down') },
    }
    const unhandled = collectUnhandledRejections()

    try {
      fireAndForget(Promise.reject(new Error('boom')), logger, 'flaky logger')
      await flush()

      expect(unhandled.reasons).toEqual([])
    }
    finally {
      unhandled.restore()
    }
  })
})

import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SharedDelayService } from './delay.service'

/**
 * F-05 回归：delay 原实现 try { void task() } catch 抓不到异步拒绝
 * （task 可以是 async fn），reject 会逃成进程级 unhandledRejection。
 * 这里用 process 级监听器钉住「零未处理拒绝」——就是 F-05 的真正判据。
 */
describe('sharedDelayService (F-05)', () => {
  let service: SharedDelayService
  let errorSpy: ReturnType<typeof vi.spyOn>
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)

  beforeEach(() => {
    vi.useFakeTimers()
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    service = new SharedDelayService()
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
  })

  it('async task reject：不产生 unhandledRejection，且记录 error 日志', async () => {
    service.schedule('async-fail', async () => {
      throw new Error('async boom')
    }, 10)

    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()

    expect(unhandled).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[fireAndForget]'),
      expect.any(String),
    )
  })

  it('sync throw：同样被收编（不再走 console.error）', async () => {
    service.schedule('sync-fail', () => {
      throw new Error('sync boom')
    }, 10)

    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()

    expect(unhandled).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('cancel 后任务不再执行', async () => {
    const task = vi.fn()
    service.schedule('cancel-me', task, 10)
    service.cancel('cancel-me')

    await vi.advanceTimersByTimeAsync(20)

    expect(task).not.toHaveBeenCalled()
  })
})

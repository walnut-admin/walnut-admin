import { describe, expect, it } from 'vitest'
import { loggerContextALS } from '../logger-context.als'
import { LoggerContextService } from '../logger-context.service'
import { ALSRequestService } from '../request.service'

/**
 * D13② 的共存判据（`libs/context` 并入 `libs/als`：**模块合一、ALS 实例不合并**）。
 *
 * 两套 store 都靠 `run()` 做整段替换，共用实例时后跑的 `run()` 会把先前那份顶掉 ——
 * `ALSRequestInterceptor` 一进请求上下文，handler 里 winston formatter 就读不到 requestId。
 * 这条链路（中间件 → 拦截器 → handler）没有 int-spec 覆盖，store 隔离语义在这里锁住：
 * 改回单实例时，本文件的第二个用例会红。
 */
describe('logger 上下文与请求上下文共存（两个 AsyncLocalStorage 实例）', () => {
  it('run() 内服务与裸 ALS 读到同一个 requestId，run() 外为 undefined', () => {
    const loggerContext = new LoggerContextService()

    expect(loggerContext.getRequestId()).toBeUndefined()
    expect(loggerContext.getStore()).toBeUndefined()

    const seen = loggerContext.run({ requestId: 'req-1' }, () => ({
      viaService: loggerContext.getRequestId(),
      viaRawALS: loggerContextALS.getStore()?.requestId,
    }))

    expect(seen).toEqual({ viaService: 'req-1', viaRawALS: 'req-1' })
    expect(loggerContext.getRequestId()).toBeUndefined()
  })

  it('进请求上下文后 logger 上下文的 requestId 不被顶掉', () => {
    const loggerContext = new LoggerContextService()
    const requestContext = new ALSRequestService()

    const seen = loggerContext.run({ requestId: 'req-2' }, () =>
      requestContext.run(() => {
        requestContext.set('userId', 'user-2')
        return {
          requestUserId: requestContext.get('userId'),
          loggerRequestId: loggerContext.getRequestId(),
          rawLoggerStore: loggerContextALS.getStore()?.requestId,
          hasRequestStore: requestContext.hasActiveContext(),
        }
      }))

    expect(seen).toEqual({
      requestUserId: 'user-2',
      loggerRequestId: 'req-2',
      rawLoggerStore: 'req-2',
      hasRequestStore: true,
    })
  })

  it('logger 上下文自己嵌套 run() 只替换自己的 store', () => {
    const loggerContext = new LoggerContextService()
    const requestContext = new ALSRequestService()

    const seen = loggerContext.run({ requestId: 'outer' }, () =>
      requestContext.run(() => {
        const innerRequestId = loggerContext.run({ requestId: 'inner' }, () => loggerContext.getRequestId())
        return {
          innerRequestId,
          outerAgain: loggerContext.getRequestId(),
          hasRequestStore: requestContext.hasActiveContext(),
        }
      }))

    expect(seen).toEqual({ innerRequestId: 'inner', outerAgain: 'outer', hasRequestStore: true })
  })
})

import { Injectable, Logger } from '@nestjs/common'
import { ILoggerContextStore, loggerContextALS } from './logger-context.als'

/**
 * Logger 上下文服务（DI 壳）
 *
 * 把请求级追踪字段（`requestId`）挂到 ALS 上，供中间件 / formatter 读取。
 * 是 `loggerContextALS` 的 NestJS DI 包装 —— 容器外的场景（winston formatter）直接用裸实例。
 *
 * @example
 * ```typescript
 * // 中间件 / 拦截器（走 DI）
 * constructor(private readonly loggerContextService: LoggerContextService) {}
 *
 * use(req, res, next) {
 *   return this.loggerContextService.run({ requestId: req.id }, () => next())
 * }
 *
 * // 异步链路里任意位置（走 DI）
 * const requestId = this.loggerContextService.getRequestId()
 * ```
 */
@Injectable()
export class LoggerContextService {
  private readonly logger = new Logger(LoggerContextService.name)

  /**
   * 在 logger 上下文里执行回调
   * @param store - 上下文数据（`requestId`）
   * @param callback - 在上下文内执行的回调
   * @returns 回调的返回值
   */
  run<T>(store: ILoggerContextStore, callback: () => T): T {
    this.logger.debug(`Creating logger context with requestId: ${store.requestId}`)
    return loggerContextALS.run(store, callback)
  }

  /**
   * 读当前上下文的 requestId
   * @returns 不在上下文内时为 undefined
   */
  getRequestId(): string | undefined {
    const store = loggerContextALS.getStore()
    return store?.requestId
  }

  /**
   * 读当前上下文的整个 store
   * @returns 不在上下文内时为 undefined
   */
  getStore(): ILoggerContextStore | undefined {
    return loggerContextALS.getStore()
  }
}

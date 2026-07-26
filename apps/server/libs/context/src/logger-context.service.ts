import { Injectable, Logger } from '@nestjs/common'
import { ILoggerContextStore, loggerContextALS } from './logger-context.als'

/**
 * Logger Context Service
 *
 * Provides AsyncLocalStorage-based context for logging purposes.
 * Stores requestId for tracing logs across async operations.
 *
 * This is the NestJS DI-friendly wrapper around loggerContextALS.
 * For non-DI usage (e.g., winston formatters), use loggerContextALS directly.
 *
 * @example
 * ```typescript
 * // In middleware/interceptor (with DI)
 * constructor(private readonly loggerContextService: LoggerContextService) {}
 *
 * intercept(context, next) {
 *   return this.loggerContextService.run({ requestId: 'uuid' }, () => {
 *     return next.handle()
 *   })
 * }
 *
 * // Anywhere in the async context (with DI)
 * const requestId = this.loggerContextService.getRequestId()
 * ```
 */
@Injectable()
export class LoggerContextService {
  private readonly logger = new Logger(LoggerContextService.name)

  /**
   * Run callback within a logger context
   * @param store - The context store containing requestId
   * @param callback - Function to execute within the context
   * @returns The result of the callback
   */
  run<T>(store: ILoggerContextStore, callback: () => T): T {
    this.logger.debug(`Creating logger context with requestId: ${store.requestId}`)
    return loggerContextALS.run(store, callback)
  }

  /**
   * Get the current requestId from the context
   * @returns The requestId or undefined if not in context
   */
  getRequestId(): string | undefined {
    const store = loggerContextALS.getStore()
    return store?.requestId
  }

  /**
   * Get the full store from the context
   * @returns The store or undefined if not in context
   */
  getStore(): ILoggerContextStore | undefined {
    return loggerContextALS.getStore()
  }
}

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Logger Context Store Interface
 */
export interface ILoggerContextStore {
  /** Unique request ID for tracing */
  requestId: string
}

/**
 * Global AsyncLocalStorage instance for logger context
 *
 * This is exported for non-DI usage (e.g., winston formatters).
 * For DI usage, use LoggerContextService instead.
 *
 * @example
 * ```typescript
 * // Non-DI usage (e.g., winston formatters)
 * import { loggerContextALS } from '@walnut/context'
 *
 * const store = loggerContextALS.getStore()
 * if (store) {
 *   console.log(store.requestId)
 * }
 * ```
 */
export const loggerContextALS = new AsyncLocalStorage<ILoggerContextStore>()

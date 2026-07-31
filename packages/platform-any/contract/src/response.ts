/**
 * Standard API response envelope shared between frontend and backend.
 */
export interface ResponseBase<T = any> {
  /** Business status code (20000 = success, see WalnutAdminConstAppResponseCode) */
  code: number
  /** Human-readable message */
  msg: string
  /** Response payload */
  data: T
  /** Unique request identifier (for tracing) */
  requestId?: string
  /** Additional metadata */
  meta?: Record<string, unknown>
  /** Developer-only debug message (stripped in production) */
  _devMsg?: string
}

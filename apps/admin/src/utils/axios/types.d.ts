export {}

/**
 * 统一响应壳的非成功分支抛出的错误形态。
 *
 * 响应拦截器在过去只抛 `Error('[code] msg')` —— 业务码与 `meta` 全被丢掉，调用方
 * （锁屏退避倒计时是新消费方）只能去正则解析 message。这里把 `code / msg / meta`
 * 原样挂回 Error，调用方不必再猜。
 */
export interface IAppResponseError extends Error {
  code?: number
  msg?: string
  meta?: Record<string, unknown>
}

declare module 'axios' {
  interface AxiosRequestConfig<D = any, R = any> {
    _carryToken?: boolean
    _timestamp?: boolean
    _cache?: boolean
    _cache_force_update?: boolean
    _retryTimes?: number
    _throttle?: number
    _mergeRequest?: boolean
    _cancelOnRouteChange?: boolean
    _requestId?: string
    _autoDecryptResponseData?: (keyof R & string)[]
    _autoEncryptRequestData?: (keyof D & string)[]
    _encrypted?: boolean
    _plainData?: any
    /** P0-1：40605 自愈（initial + 重放）只做一次的标记，防死循环 */
    _deviceResetRetried?: boolean
    /** P1：40117 无感刷新（refresh + 重放）只做一次的标记，防 40117 → 空 token → 重放的死循环 */
    _capRefreshRetried?: boolean
    /** E2：40119 二次验证（弹窗 + 重放）只做一次的标记，防「验证过了但仍 40119」无限弹窗 */
    _sensitiveVerifyRetried?: boolean
  }
}

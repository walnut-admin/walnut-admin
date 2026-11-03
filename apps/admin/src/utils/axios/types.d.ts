export {}

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
  }
}

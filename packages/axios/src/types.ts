import type { ResponseBase } from '@walnut/contract/response'
import type { AxiosError, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'

// Re-export contract types for backward compatibility
export type { ResponseBase }
export type { BaseListParams, BaseListResponse, BasePageParams, BaseSortParams, SortOrder } from '@walnut/contract/pagination'

export interface AxiosConfig {
  originalConfig: AxiosRequestConfig
  transformers: AxiosTransformers
}

export interface AxiosTransformers<T = any> {
  requestInterceptors?: (config: InternalAxiosRequestConfig) => Promise<InternalAxiosRequestConfig>
  requestInterceptorsCatch?: (error: Error) => void
  responseInterceptors?: (res: AxiosResponse) => Promise<T | void>
  responseInterceptorsCatch?: <E = any>(error: AxiosError<E>) => void
}

/**
 * @deprecated Use ResponseBase from @walnut/contract/response instead.
 * Kept for backward compatibility.
 */
export type BaseResponse<T = any> = ResponseBase<T>

// Augment AxiosRequestConfig with custom adapter config properties
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
  }
}

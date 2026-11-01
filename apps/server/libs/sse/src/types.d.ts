import type { IWalnutAdminSseClientData as IWalnutAdminSseClientDataContract } from '@walnut/contract/sse'

// 契约上收（2026-11-01）：SSE 信封形状的单一真源是 @walnut/contract/sse。
// 全局名保留，server 既有调用点（sse.service / oauth controllers）零改动；
// 同时 re-export，让下游也能按模块方式 import。
declare global {
  interface IWalnutAdminSseClientData<T = any> extends IWalnutAdminSseClientDataContract<T> {}
}

export type { IWalnutAdminSseClientData } from '@walnut/contract/sse'

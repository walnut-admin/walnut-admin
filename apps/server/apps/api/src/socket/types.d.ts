import type {
  IWalnutAdminSocketEventDataMap as IWalnutAdminSocketEventDataMapContract,
  IWalnutAdminSocketEvents as IWalnutAdminSocketEventsContract,
} from '@walnut/contract/socket'

// 契约上收（2026-11-01）：事件联合与 payload map 的单一真源是 @walnut/contract/socket。
// 全局名保留（socket.service / gateway 既有调用点零改动）；room 模板是 server 侧约定，留在此处。
declare global {
  type IWalnutAdminSocketEvents = IWalnutAdminSocketEventsContract

  interface IWalnutAdminSocketEventDataMap extends IWalnutAdminSocketEventDataMapContract {}

  type IWalnutAdminSocketRoom = `user:${string}:${string}`
}

export type { IWalnutAdminSocketEventDataMap, IWalnutAdminSocketEvents } from '@walnut/contract/socket'

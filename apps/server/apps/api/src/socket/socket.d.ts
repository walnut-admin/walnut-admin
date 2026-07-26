import type { Socket } from 'socket.io'
import type { IWalnutAdminSocketEventDataMap, WalnutAdminSocketEvents } from './socket.const'

// Server -> Client 事件（服务端发送给客户端）
interface ISocketServerToClientEvents {
// 显式定义每个事件 - 不使用映射类�?
  [WalnutAdminSocketEvents.LOCK]: (data: IWalnutAdminSocketEventDataMap[typeof WalnutAdminSocketEvents.LOCK]) => void
  [WalnutAdminSocketEvents.UNLOCK]: (data: IWalnutAdminSocketEventDataMap[typeof WalnutAdminSocketEvents.UNLOCK]) => void
  [WalnutAdminSocketEvents.FORCE_QUIT]: (data: IWalnutAdminSocketEventDataMap[typeof WalnutAdminSocketEvents.FORCE_QUIT]) => void
}

// Client -> Server 事件（客户端发送给服务端）
interface ISocketClientToServerEvents {
  hello: (data: string) => void
}

// 服务器之间的事件（集群模式下使用�?
interface ISocketInterServerEvents {
  ping: () => void
}

// Socket 实例上挂载的自定义数�?
interface ISocketData {
  userId: string
  deviceId: string
  fingerprint: string
}

type ISocket = Socket<
  ISocketClientToServerEvents,
  ISocketServerToClientEvents,
  ISocketInterServerEvents,
  ISocketData
>

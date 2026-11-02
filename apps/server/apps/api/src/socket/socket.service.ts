import { Injectable, Logger } from '@nestjs/common'
import { Namespace } from 'socket.io'
import { ISocketClientToServerEvents, ISocketData, ISocketInterServerEvents, ISocketServerToClientEvents } from './socket'
import { WalnutAdminSocketRooms } from './socket.const'
// Note: IWalnutAdminSocketEvents and IWalnutAdminSocketEventDataMap are now global types from @walnut-server/types

@Injectable()
export class SocketService {
  public socket: Namespace<
    ISocketClientToServerEvents,
    ISocketServerToClientEvents,
    ISocketInterServerEvents,
    ISocketData
  > | null = null

  private readonly logger = new Logger(SocketService.name)

  /**
   * 发送事件到指定房间（类型安全版本）
   */
  sendToRoom<E extends IWalnutAdminSocketEvents>(
    room: string,
    event: E,
    data: E extends keyof IWalnutAdminSocketEventDataMap
      ? IWalnutAdminSocketEventDataMap[E]
      : never,
  ): void {
    this.socket?.to(room).emit(event as any, data)
    // F-06：只打事件类型与定位 id（room 本身即 user:userId:visitorId），不把 payload 全量
    // 入日志（force:quit 等事件带用户身份字段；顺带避免 JSON.stringify 遇到循环引用抛错）。
    this.logger.log(`[sendToRoom] room: ${room}, event: ${event}`)
  }

  /**
   * 发送事件到用户房间（类型安全版本）
   */
  sendToUserRoom<E extends IWalnutAdminSocketEvents>(
    userId: string,
    fingerprint: string,
    event: E,
    data?: E extends keyof IWalnutAdminSocketEventDataMap
      ? IWalnutAdminSocketEventDataMap[E]
      : never,
  ): void {
    const room = WalnutAdminSocketRooms.USER(userId, fingerprint)
    this.sendToRoom(room, event, data as never)
    // F-06：user-room 的定位口径是 userId/event；fp（fingerprint）是 SSE/OAuth 投递通道键，
    // 不单独入日志（room 字符串里已含它，见 sendToRoom 的日志）。
    this.logger.log(`[sendToUserRoom] userId: ${userId}, event: ${event}`)
  }

  /**
   * 广播事件到所有客户端
   */
  broadcast<E extends IWalnutAdminSocketEvents>(
    event: E,
    data: E extends keyof IWalnutAdminSocketEventDataMap
      ? IWalnutAdminSocketEventDataMap[E]
      : never,
  ): void {
    this.socket?.emit(event as any, data)
    // F-06：广播只打事件类型，不打 payload。
    this.logger.log(`[broadcast] event: ${event}`)
  }

  /**
   * 发送到多个房间
   */
  sendToRooms<E extends IWalnutAdminSocketEvents>(
    rooms: string[],
    event: E,
    data: E extends keyof IWalnutAdminSocketEventDataMap
      ? IWalnutAdminSocketEventDataMap[E]
      : never,
  ): void {
    this.socket?.to(rooms).emit(event as any, data)
    // F-06：只打房间列表与事件类型，不打 payload。
    this.logger.log(`[sendToRooms] rooms: ${rooms.join(', ')}, event: ${event}`)
  }
}

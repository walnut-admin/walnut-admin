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
    this.logger.log(`[sendToRoom] room: ${room}, event: ${event}, data: ${JSON.stringify(data)}`)
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
    this.logger.log(`[sendToUserRoom] userId: ${userId}, fingerprint: ${fingerprint}, event: ${event}`)
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
    this.logger.log(`[broadcast] event: ${event}, data: ${JSON.stringify(data)}`)
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
    this.logger.log(`[sendToRooms] rooms: ${rooms.join(', ')}, event: ${event}, data: ${JSON.stringify(data)}`)
  }
}

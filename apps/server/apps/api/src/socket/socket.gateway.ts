import process from 'node:process'

import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { instrument } from '@socket.io/admin-ui'

import { Namespace } from 'socket.io'
import { AppMonitorUserService } from '@/modules/app/monitor/user/user.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import {
  ISocket,
  ISocketClientToServerEvents,
  ISocketData,
  ISocketInterServerEvents,
  ISocketServerToClientEvents,
} from './socket'
import { WalnutAdminSocketEvents, WalnutAdminSocketRooms } from './socket.const'
import { SocketAuthMiddleware } from './socket.middleware'
import { SocketService } from './socket.service'

// TODO extract to config
const ns = 'walnut-namespace'

@WebSocketGateway({
  namespace: ns,
})
export class SocketGateway
implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SocketGateway.name)

  constructor(
    private readonly socketService: SocketService,
    private readonly configService: ConfigService,
    private readonly monitorUserService: AppMonitorUserService,
    private readonly socketAuthMiddleware: SocketAuthMiddleware,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
  ) {}

  @WebSocketServer()
  private readonly server: Namespace<
    ISocketClientToServerEvents,
    ISocketServerToClientEvents,
    ISocketInterServerEvents,
    ISocketData
  >

  afterInit(
    namespace: Namespace<
      ISocketClientToServerEvents,
      ISocketServerToClientEvents,
      ISocketInterServerEvents,
      ISocketData
    >,
  ) {
    // auth middleware to hang the necessary data to socket.data
    namespace.use((socket, next) => void this.socketAuthMiddleware.middleware(socket, next))

    // instrument
    instrument(namespace.server, {
      auth: false,
      mode: process.env.NODE_ENV as 'development' | 'production',
      namespaceName: ns,
    })

    this.logger.log(
      `Websocket Server Started, Listening on Port: ${this.configService.get<number>(
        'socket.port',
      )}`,
    )

    this.socketService.socket = namespace
  }

  // connection
  async handleConnection(client: ISocket, ..._args: any[]) {
    this.logger.log(`Client connected: ${client.id}`)

    const { userId, fingerprint, deviceId } = client.data

    this.logger.log(`Client data: userId => ${userId}; deviceId => ${deviceId}; fingerprint => ${fingerprint}`)

    // join userId room
    await client.join(WalnutAdminSocketRooms.USER(userId, fingerprint))

    try {
      // �?检查是否需要强制退�?
      const result = await this.monitorUserService.handleSocketInitForceQuit(userId, deviceId)

      if (result.shouldForceQuit && result.revokeReason) {
      // 获取对应的退出策�?
        const forceQuitConfig = await this.cacheAppSettingsService.getForceQuitConfig()
        const strategy = forceQuitConfig[result.revokeReason]

        // �?只通知当前 socket，不触发新的踢人流程
        client.emit(WalnutAdminSocketEvents.FORCE_QUIT, { strategy })

        this.logger.log(
          `Force quit on init - device: ${deviceId}, reason: ${result.revokeReason}, strategy: ${strategy}`,
        )
      }
    }
    catch (error: any) {
      this.logger.error(`Force quit user failed: ${error}`)
    }
  }

  // disconnection
  async handleDisconnect(client: ISocket) {
    this.logger.log(`Client disconnected: ${client.id}`)
  }

  @SubscribeMessage('hello')
  onHello(@MessageBody() data: string) {
    this.logger.log(data)
    // 这个事件不在类型定义中，如果需要类型安全，应该添加�?ISocketServerToClientEvents
    this.server.emit('onMessage' as any, { msg: 'Hello world', content: data })
  }
}

import type { IWalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'

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

import { AppMonitorUserService } from '@walnut-server/app-domain'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { WalnutAdminConstAppEnv, WalnutAdminEnv } from '@walnut-server/const/app/env'
import { Namespace } from 'socket.io'
import {
  ISocket,
  ISocketClientToServerEvents,
  ISocketData,
  ISocketInterServerEvents,
  ISocketServerToClientEvents,
} from './socket'
import { WalnutAdminSocketEvents, WalnutAdminSocketNamespace, WalnutAdminSocketRooms } from './socket.const'
import { SocketAuthMiddleware } from './socket.middleware'
import { SocketService } from './socket.service'

@WebSocketGateway({
  namespace: WalnutAdminSocketNamespace,
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

    // F-01（P0，2026-11-02）：admin UI 仅在用户名与密码**同时**配置时挂载
    // （fail-closed：不配置 = 不挂载 + warn）。此前 auth:false + NODE_ENV 裸 as 断言是
    // 无鉴权裸奔（review F-01）。env 口径见 libs/config validation.ts（可选；
    // password 必须是 bcrypt hash —— bcryptjs.hash(强口令, 10)，强口令 >= 8 位）。
    const adminUiUser = this.configService.get<string>('SOCKET_ADMIN_UI_USER')
    const adminUiPassword = this.configService.get<string>('SOCKET_ADMIN_UI_PASSWORD')

    // 显式 nullish/empty 判定（ts/strict-boolean-expressions）：任一缺失/空串 = 未配置
    const hasAdminUiCredentials = adminUiUser !== undefined
      && adminUiUser !== ''
      && adminUiPassword !== undefined
      && adminUiPassword !== ''

    if (hasAdminUiCredentials) {
      // mode 经 WalnutAdminEnv（libs/const/app/env）判定，不用裸 as：production 之外
      // （development / stage / 测试）一律 development 模式
      const mode: 'development' | 'production' = WalnutAdminEnv === WalnutAdminConstAppEnv.PROD
        ? 'production'
        : 'development'

      instrument(namespace.server, {
        auth: { type: 'basic', username: adminUiUser, password: adminUiPassword },
        mode,
        namespaceName: WalnutAdminSocketNamespace,
      })
    }
    else {
      this.logger.warn(
        'SOCKET_ADMIN_UI_USER / SOCKET_ADMIN_UI_PASSWORD 未同时配置 —— socket.io Admin UI 不挂载（fail-closed）。'
        + '生产如需使用请补配：PASSWORD 用 bcryptjs.hash(强口令, 10) 生成（强口令 >= 8 位），不接受明文',
      )
    }

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
      // 先检查是否需要强制退出
      const result = await this.monitorUserService.handleSocketInitForceQuit(userId, deviceId)

      if (result.shouldForceQuit && result.revokeReason) {
      // 获取对应的退出策略（'rotate' 是 RT 轮换行标记，非 force-quit 触发因，不可能成为
      // 「最新撤销行」的原因 —— 新插入的现役行永远比 rotate 旧行新；类型面收窄）
        const forceQuitConfig = await this.cacheAppSettingsService.getForceQuitConfig()
        const strategy = forceQuitConfig[result.revokeReason as Exclude<IWalnutAdminConstRevokeRTType, 'rotate'>]

        // 只通知当前 socket，不触发新的踢人流程
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
    // 这个事件不在类型定义中，如果需要类型安全，应该加到 ISocketServerToClientEvents
    this.server.emit('onMessage' as any, { msg: 'Hello world', content: data })
  }
}

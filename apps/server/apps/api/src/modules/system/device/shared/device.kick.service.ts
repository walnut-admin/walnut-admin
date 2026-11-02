import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { AuthSignoutService } from '@walnut-server/auth'
import { IWalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { runAfterCommit } from '@walnut-server/db'
import { IWalnutAdminSystemDeviceKicker } from '@walnut-server/system'
import { SocketService } from '@/socket/socket.service'

/**
 * 「封禁 = 踢下线」端口的实现（review 拍板-4）。
 *
 * 两条腿分属两层，所以实现只能落在这里（app 的组合根）：
 * - **令牌 / 会话腿**在 `@walnut-server/auth`（`AuthSignoutService.kickDeviceOffline`：
 *   撤该设备全部 RT + 清各用户的会话/权限/MFA 缓存键）；
 * - **实时腿**在 app（`SocketService.kickDeviceSockets`：按 socket.data.deviceId 断开）。
 *
 * 时序：RT 撤销与封禁写同一事务（回滚则封禁与撤销一起回滚）；缓存清扫在 `kickDeviceOffline`
 * 内部 registerAfterCommit；socket 断开在本方法末尾再挂一次 after-commit —— 没提交的事务
 * 不该断人家的连接。
 */
@Injectable()
export class SysDeviceKickService implements IWalnutAdminSystemDeviceKicker {
  private readonly logger = new Logger(SysDeviceKickService.name)

  constructor(
    private readonly signoutService: AuthSignoutService,
    private readonly socketService: SocketService,
  ) {}

  async kickDevice(
    deviceId: string,
    revokeReason: IWalnutAdminConstRevokeRTType,
    em?: EntityManager,
  ) {
    const userIds = await this.signoutService.kickDeviceOffline(deviceId, revokeReason, em)

    await runAfterCommit(async () => {
      const closed = this.socketService.kickDeviceSockets(deviceId)

      this.logger.log(
        `Device kicked - device: ${deviceId}, users: ${userIds.length}, sockets closed: ${closed}`,
      )
    })

    return userIds
  }
}

import { Injectable } from '@nestjs/common'
import { IWalnutAdminConstRevokeRTType, WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { WalnutAdminSocketEvents } from '@/socket/socket.const'
// Note: IWalnutAdminSocketEvents is now a global type from @walnut-server/types
import { SocketService } from '@/socket/socket.service'
import { AppMonitorUserRepositoryService } from '../repo/user.repo.service'

/** B7b 迁移：refresh 行从 Mongo 文档换成 PG 实体（cron 只消费 userId / deviceId 两个键） */
interface IExpiredRefreshTokenLike {
  userId: string
  deviceId: string
}

@Injectable()
export class AppMonitorUserSharedService {
  constructor(
    private readonly appMonitorUserRepo: AppMonitorUserRepositoryService,
    private readonly socketService: SocketService,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
  ) {}

  /**
   * @description send socket event to all monitors of user
   */
  async sendSocketEventToUserAllMonitors(userId: string, event: IWalnutAdminSocketEvents, data?: object) {
    const allMonitors = await this.appMonitorUserRepo.findAllByUserId(userId)
    const authOnlineMonitors = allMonitors.filter(m => m.auth && !m.left)
    for (const monitor of authOnlineMonitors) {
      this.socketService.sendToUserRoom(userId, monitor.visitorId?.toString(), event, data)
    }
  }

  /**
   * @description force quit monitor by socket
   */
  async forceQuitMonitorBySocket(userId: string, visitorId: string, revokeReason?: IWalnutAdminConstRevokeRTType) {
    const forceQuitConfig = await this.cacheAppSettingsService.getForceQuitConfig()

    this.socketService.sendToUserRoom(userId, visitorId, WalnutAdminSocketEvents.FORCE_QUIT, {
      strategy: forceQuitConfig[revokeReason || WalnutAdminConstRevokeRTType.forceQuitOnline],
    })
  }

  /**
   * @description force quit to all auth online monitors by socket
   */
  async forceQuitMonitorsBySocket(userId: string, revokeReason: IWalnutAdminConstRevokeRTType) {
    const allMonitors = await this.appMonitorUserRepo.findAllByUserId(userId)
    const authOnlineMonitors = allMonitors.filter(m => m.auth && !m.left)
    for (const monitor of authOnlineMonitors) {
      await this.forceQuitMonitorBySocket(userId, monitor.visitorId?.toString(), revokeReason)
    }
    return authOnlineMonitors
  }

  /**
   * @description change the auth state based on refresh token expire time
   * used for bull task
   */
  async updateAuthStateForCronJob(expiredTarget: IExpiredRefreshTokenLike[]) {
    const res = await Promise.allSettled(
      expiredTarget.map(async (i) => {
        const monitorData = await this.appMonitorUserRepo.findByUserIdAndDeviceId(
          i.userId,
          i.deviceId,
        )

        if (!monitorData) {
          return false
        }

        await this.appMonitorUserRepo.updateAuthState(monitorData)

        return true
      }),
    )

    return res.filter(i => i.status === 'fulfilled')
  }
}

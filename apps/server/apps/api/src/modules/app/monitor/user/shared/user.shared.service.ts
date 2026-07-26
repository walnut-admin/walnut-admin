import { Injectable } from '@nestjs/common'
import { IWalnutAdminConstRevokeRTType, WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { IAuthRefreshTokenDocument } from '@/modules/auth/modules/refresh/schema/refresh.schema'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { WalnutAdminSocketEvents } from '@/socket/socket.const'
// Note: IWalnutAdminSocketEvents is now a global type from @walnut-server/types
import { SocketService } from '@/socket/socket.service'
import { AppMonitorUserRepositoryService } from '../repo/user.repo.service'

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
  async updateAuthStateForCronJob(expiredTarget: IAuthRefreshTokenDocument[]) {
    const res = await Promise.allSettled(
      expiredTarget.map(async (i) => {
        const monitorData = await this.appMonitorUserRepo.findByUserIdAndDeviceId(
          i.userId.toString(),
          i.deviceId,
        )

        if (!monitorData)
          return false

        monitorData.auth = false
        monitorData.userId = null
        await monitorData.save()

        return true
      }),
    )

    return res.filter(i => i.status === 'fulfilled')
  }
}

import type { IIdentityUserNotifier } from '@walnut-server/identity'
import { Injectable } from '@nestjs/common'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { IWalnutAdminConstRevokeRTType, WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
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
/** 批 6：implements 是端口绑定的编译期守护（user_lock 只认端口）。 */
export class AppMonitorUserSharedService implements IIdentityUserNotifier {
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
   * @description 批 6：身份内核的单设备 socket 通知端口实现（user_lock 的 lock/unlock）。
   * 与 sendSocketEventToUserAllMonitors 共用同一 SocketService，行为不变。
   */
  sendSocketEventToUserDevice(userId: string, fingerprint: string, event: IWalnutAdminSocketEvents) {
    this.socketService.sendToUserRoom(userId, fingerprint, event)
  }

  /**
   * @description force quit monitor by socket
   */
  async forceQuitMonitorBySocket(userId: string, visitorId: string, revokeReason?: IWalnutAdminConstRevokeRTType) {
    const forceQuitConfig = await this.cacheAppSettingsService.getForceQuitConfig()

    this.socketService.sendToUserRoom(userId, visitorId, WalnutAdminSocketEvents.FORCE_QUIT, {
      // 'rotate' 是 RT 轮换行标记（revoke-and-insert，2026-10-27），不是 force-quit 触发因，
      // 不会从踢人链路传入 —— 索引面收窄回 12 个触发因
      strategy: forceQuitConfig[(revokeReason as Exclude<IWalnutAdminConstRevokeRTType, 'rotate'>) || WalnutAdminConstRevokeRTType.forceQuitOnline],
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

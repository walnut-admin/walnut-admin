import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { AppMonitorUserRepositoryService } from '@/modules/app/monitor/user/repo/user.repo.service'
import { AuthSignoutService } from '@/modules/auth/modules/signout/signout.service'
import { getDeviceLocationString } from '../device/entity/device.entity'
import { SysDeviceRepositoryService } from '../device/repo/device.repo.service'
import { SysUserLockSharedService } from '../user_lock/shared/user_lock.shared.service'
import { SysUserDeviceRepositoryService } from './repo/user_device.repo.service'

/**
 * B6 迁移：populate 链（user_device → device → monitor_user）两表均已迁 PG，改为按
 * 业务键 device_id 应用层装回（对照 Mongo 版 populate 出参字段，形态不变）；事务句柄
 * `dbSession` → `em`。B7b 归一：doSignout 的 refresh 写腿亦迁 PG —— forceQuit /
 * lock / unlock 的双句柄收成单 em。
 */
@Injectable()
export class SysUserDeviceService {
  private readonly logger = new Logger(SysUserDeviceService.name)

  constructor(
    private readonly userDeviceRepo: SysUserDeviceRepositoryService,
    private readonly appMonitorUserRepo: AppMonitorUserRepositoryService,

    private readonly deviceRepoService: SysDeviceRepositoryService,
    private readonly userLockSharedService: SysUserLockSharedService,
    private readonly signoutService: AuthSignoutService,
  ) { }

  /**
   * @description get current user device list
   */
  async getCurrentUserDeviceList(userId: string, deviceId: string) {
    const list = await this.userDeviceRepo.findAllDevicesForCurrentUser(userId)

    const res = await Promise.all(list.map(async (item) => {
      const populated_device = await this.deviceRepoService.findDeviceByDeviceId(item.deviceId)
      const populated_monitor_user = populated_device
        ? await this.appMonitorUserRepo.findFirstByDeviceId(item.deviceId)
        : null

      return { item, populated_device, populated_monitor_user }
    }))

    const promises = await Promise.all(res.map(async ({ item, populated_device, populated_monitor_user }) => ({
      deviceId: item?.deviceId,
      deviceName: item?.deviceName,
      locked: item?.locked,
      lastActiveAt: item?.lastActiveAt,
      deviceType: (populated_device?.deviceInfo?.type as string) ?? undefined,
      current: item?.deviceId === deviceId,
      auth: (populated_monitor_user?.auth as boolean) ?? undefined,
      location: populated_device ? getDeviceLocationString(populated_device) : undefined,
    })))

    return promises.sort((a, b) => (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0))
  }

  /**
   * @description update user device name
   */
  async updateUserDeviceName(userId: string, deviceId: string, deviceName: string) {
    await this.userDeviceRepo.updateUserDeviceName(userId, deviceId, deviceName)
    return true
  }

  /**
   * @description force quit user device
   */
  async forceQuitUserDevice(userId: string, deviceId: string, em?: EntityManager) {
    const monitorUser = await this.appMonitorUserRepo.findByUserIdAndDeviceId(userId, deviceId, em)
    if (!monitorUser) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    await this.signoutService.doSignout(
      userId,
      { trigger: 'user-kick-other', deviceId, fingerprint: monitorUser.visitorId, isOnline: !monitorUser.left },
      em,
    )
    return true
  }

  /**
   * @description lock user device
   */
  async lockUserDeviceWithUserIdAndDeviceId(userId: string, deviceId: string, em?: EntityManager) {
    const monitorUser = await this.appMonitorUserRepo.findByUserIdAndDeviceId(userId, deviceId)
    if (!monitorUser) {
      throw new WalnutAdminExceptionDataNotFound()
    }
    return this.userLockSharedService.lockUserDevice(userId, deviceId, monitorUser.visitorId, {}, em)
  }

  /**
   * @description unlock user device
   */
  async unlockUserDeviceWithUserIdAndDeviceId(userId: string, deviceId: string, lockHashPwd: string, em?: EntityManager) {
    const monitorUser = await this.appMonitorUserRepo.findByUserIdAndDeviceId(userId, deviceId)
    if (!monitorUser) {
      throw new WalnutAdminExceptionDataNotFound()
    }
    return this.userLockSharedService.unLockUserDevice(userId, deviceId, monitorUser.visitorId, lockHashPwd, em)
  }
}

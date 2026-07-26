import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBVirtualName } from '@walnut-server/db'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { ClientSession } from 'mongoose'
import { AppMonitorUserRepositoryService } from '@/modules/app/monitor/user/repo/user.repo.service'
import { AuthSignoutService } from '@/modules/auth/modules/signout/signout.service'
import { SysUserLockSharedService } from '../user_lock/shared/user_lock.shared.service'
import { SysUserDeviceRepositoryService } from './repo/user_device.repo.service'

@Injectable()
export class SysUserDeviceService {
  private readonly logger = new Logger(SysUserDeviceService.name)

  constructor(
    private readonly userDeviceRepo: SysUserDeviceRepositoryService,
    private readonly appMonitorUserRepo: AppMonitorUserRepositoryService,

    private readonly userLockSharedService: SysUserLockSharedService,
    private readonly signoutService: AuthSignoutService,
  ) { }

  /**
   * @description get current user device list
   */
  async getCurrentUserDeviceList(userId: string, deviceId: string) {
    const list = await this.userDeviceRepo.findAllDevicesForCurrentUser(userId)

    const res = await Promise.all(list.map(async item => item.populate({
      path: WalnutDBVirtualName.DEVICE,
      populate: {
        path: WalnutDBVirtualName.MONITOR_USER,
      },
    })))

    const promises = await Promise.all(res.map(async i => ({
      deviceId: i?.deviceId,
      deviceName: i?.deviceName,
      locked: i?.locked,
      lastActiveAt: i?.lastActiveAt,
      deviceType: i?.populated_device?.deviceInfo?.type as string,
      current: i?.deviceId === deviceId,
      auth: i?.populated_device?.populated_monitor_user?.auth as boolean,
      location: i?.populated_device?.getLocationString() as string,
    })))

    return promises.sort((a, b) => b.lastActiveAt?.getTime() - a.lastActiveAt?.getTime())
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
  async forceQuitUserDevice(userId: string, deviceId: string, dbSession: ClientSession) {
    const monitorUser = await this.appMonitorUserRepo.findByUserIdAndDeviceId(userId, deviceId, dbSession)
    if (!monitorUser) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    await this.signoutService.doSignout(
      userId,
      { trigger: 'user-kick-other', deviceId, fingerprint: monitorUser.visitorId, isOnline: !monitorUser.left },
      dbSession,
    )
    return true
  }

  /**
   * @description lock user device
   */
  async lockUserDeviceWithUserIdAndDeviceId(userId: string, deviceId: string, dbSession: ClientSession) {
    const monitorUser = await this.appMonitorUserRepo.findByUserIdAndDeviceId(userId, deviceId)
    if (!monitorUser) {
      throw new WalnutAdminExceptionDataNotFound()
    }
    return this.userLockSharedService.lockUserDevice(userId, deviceId, monitorUser.visitorId, {}, dbSession)
  }

  /**
   * @description unlock user device
   */
  async unlockUserDeviceWithUserIdAndDeviceId(userId: string, deviceId: string, lockHashPwd: string, dbSession: ClientSession) {
    const monitorUser = await this.appMonitorUserRepo.findByUserIdAndDeviceId(userId, deviceId)
    if (!monitorUser) {
      throw new WalnutAdminExceptionDataNotFound()
    }
    return this.userLockSharedService.unLockUserDevice(userId, deviceId, monitorUser.visitorId, lockHashPwd, dbSession)
  }
}

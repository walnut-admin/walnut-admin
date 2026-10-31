import type { EntityManager } from 'typeorm'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import {
  IIdentityDeviceService,
  IIdentityMonitorRepository,
  IIdentitySignoutService,
  WALNUT_ADMIN_IDENTITY_DEVICE_SERVICE,
  WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY,
  WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE,
} from '../identity.ports'
import { getDeviceLocationString } from '../shared/device-location'
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
    @Inject(WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY)
    private readonly monitorRepo: IIdentityMonitorRepository,

    @Inject(WALNUT_ADMIN_IDENTITY_DEVICE_SERVICE)
    private readonly deviceService: IIdentityDeviceService,
    private readonly userLockSharedService: SysUserLockSharedService,
    @Inject(WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE)
    private readonly signoutService: IIdentitySignoutService,
  ) { }

  /**
   * @description get current user device list
   */
  async getCurrentUserDeviceList(userId: string, deviceId: string) {
    const list = await this.userDeviceRepo.findAllDevicesForCurrentUser(userId)

    const res = await Promise.all(list.map(async (item) => {
      const device = await this.deviceService.findDeviceByDeviceId(item.deviceId)
      const monitorUser = device
        ? await this.monitorRepo.findFirstByDeviceId(item.deviceId)
        : null

      return { item, device, monitorUser }
    }))

    const promises = await Promise.all(res.map(async ({ item, device, monitorUser }) => ({
      deviceId: item?.deviceId,
      deviceName: item?.deviceName,
      locked: item?.locked,
      lastActiveAt: item?.lastActiveAt,
      deviceType: (device?.deviceInfo?.type as string) ?? undefined,
      current: item?.deviceId === deviceId,
      auth: (monitorUser?.auth as boolean) ?? undefined,
      location: device ? getDeviceLocationString(device) : undefined,
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
    const monitorUser = await this.monitorRepo.findByUserIdAndDeviceId(userId, deviceId, em)
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
    const monitorUser = await this.monitorRepo.findByUserIdAndDeviceId(userId, deviceId)
    if (!monitorUser) {
      throw new WalnutAdminExceptionDataNotFound()
    }
    return this.userLockSharedService.lockUserDevice(userId, deviceId, monitorUser.visitorId, {}, em)
  }

  /**
   * @description unlock user device
   */
  async unlockUserDeviceWithUserIdAndDeviceId(userId: string, deviceId: string, lockHashPwd: string, em?: EntityManager) {
    const monitorUser = await this.monitorRepo.findByUserIdAndDeviceId(userId, deviceId)
    if (!monitorUser) {
      throw new WalnutAdminExceptionDataNotFound()
    }
    return this.userLockSharedService.unLockUserDevice(userId, deviceId, monitorUser.visitorId, lockHashPwd, em)
  }
}

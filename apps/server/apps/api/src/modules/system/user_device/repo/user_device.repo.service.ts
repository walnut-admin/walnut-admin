import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName, WalnutDBVirtualName } from '@walnut/db'
import { AppDayjs } from '@walnut/utils/dayjs'
import { isNil } from 'lodash'
import { ClientSession, Types } from 'mongoose'
import { ISysUserDeviceDocument, ISysUserDeviceModel } from '../schema/user_device.schema'

@Injectable()
export class SysUserDeviceRepositoryService {
  private readonly logger = new Logger(SysUserDeviceRepositoryService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_DEVICE)
    private readonly UserDeviceModel: ISysUserDeviceModel,
  ) { }

  // TODO 30 extract to config
  private readonly trustedExpiredDays = 30

  /**
   * @description calculate trusted expired date (30 days from now)
   */
  getTrustedExpiredAt(expiredAt?: Date): Date {
    const start = expiredAt || AppDayjs().toDate()
    return AppDayjs(start).add(this.trustedExpiredDays, 'day').toDate()
  }

  /**
   * @description check if device is expired
   */
  getIsDeviceExpired(trustedExpiredAt?: Date) {
    if (!trustedExpiredAt)
      return false
    return AppDayjs(trustedExpiredAt).isBefore()
  }

  /**
   * @description check if device is trusted and valid
   */
  isTrustedAndValid(device: ISysUserDeviceDocument | null): boolean {
    if (!device)
      return false

    if (!device.trusted)
      return false

    if (device.lastActiveAt === null)
      return false

    // check if trusted expired
    if (AppDayjs(device.trustedExpiredAt).isBefore(AppDayjs())) {
      return false
    }

    return true
  }

  /**
   * @description check if device is inactive for specified days
   */
  getIsDeviceInactive(lastActiveAt?: Date, offsetDays = 7) {
    // If no last active time, consider it inactive
    if (!lastActiveAt)
      return true

    // Check if the cutoff time (X days ago) is after the last active time
    // If true, it means the device hasn't been active for X days
    return AppDayjs().subtract(offsetDays, 'day').isAfter(lastActiveAt)
  }

  /**
   * @description find all devices for current user
   */
  async findAllDevicesForCurrentUser(userId: string, dbSession?: ClientSession) {
    return this.UserDeviceModel.find({
      userId: new Types.ObjectId(userId),
    }).session(dbSession!)
  }

  /**
   * @description update user device name
   */
  async updateUserDeviceName(
    userId: string,
    deviceId: string,
    deviceName: string,
    dbSession?: ClientSession,
  ) {
    return this.UserDeviceModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), deviceId },
      { deviceName },
    ).session(dbSession!)
  }

  /**
   * @description find all devices by device id with populated user
   */
  async findAllUserInCurrentDevice(deviceId: string, dbSession?: ClientSession) {
    return this.UserDeviceModel
      .find({ deviceId })
      .sort({ lastActiveAt: -1 })
      .populate({ path: WalnutDBVirtualName.USER, select: 'userName nickName' })
      .session(dbSession!)
  }

  /**
   * @description update last active at for device
   */
  async updateUserDeviceLastActiveAt(deviceId: string, userId?: string, dbSession?: ClientSession) {
    return this.UserDeviceModel.findOneAndUpdate(
      isNil(userId) ? { userId: new Types.ObjectId(userId), deviceId } : { deviceId },
      { lastActiveAt: AppDayjs().toDate() },
    ).session(dbSession!)
  }

  /**
   * @description upsert device for user
   */
  async upsertDevice(
    userId: string,
    deviceId: string,
    deviceName: string,
    dbSession: ClientSession,
  ) {
    const oldDevice = await this.findByUserAndDevice(userId, deviceId, dbSession)
    if (oldDevice) {
      return oldDevice
    }

    const newDevice = await this.UserDeviceModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(userId),
        deviceId,
        deviceName,
      },
      { userId: new Types.ObjectId(userId), deviceId, deviceName },
      {
        upsert: true,
        returnDocument: 'after',
      },
    ).session(dbSession)

    return newDevice
  }

  /**
   * @description find device by user and device id
   */
  async findByUserAndDevice(
    userId: string,
    deviceId: string,
    dbSession?: ClientSession,
  ) {
    return this.UserDeviceModel.findOne({ userId: new Types.ObjectId(userId), deviceId }).session(dbSession!)
  }

  /**
   * @description update lock status for specific device
   */
  async updateLockStatusForThisUserAndThisDevice(
    userId: string,
    deviceId: string,
    locked: boolean,
    dbSession: ClientSession,
  ) {
    const doc = await this.findByUserAndDevice(userId, deviceId, dbSession)
    if (!doc)
      return false

    doc.locked = locked
    await doc.save({ session: dbSession })
    return true
  }

  /**
   * @description update lock status for all user devices
   */
  async updateLockStatusForAllDevices(
    userId: string,
    locked: boolean,
    dbSession: ClientSession,
  ) {
    await this.UserDeviceModel.updateMany(
      { userId: new Types.ObjectId(userId), locked: { $ne: locked } },
      { locked },
      { session: dbSession },
    )
    return true
  }

  /**
   * @description check if any device is locked for user
   */
  async isAnyDeviceLockedForUser(userId: string) {
    const doc = await this.findAnyLockedDevice(userId)
    return !!doc
  }

  /**
   * @description check if device is locked for user
   */
  async isDeviceLockedForUser(userId: string, deviceId: string) {
    const doc = await this.findLockedDevice(userId, deviceId)
    return !!doc
  }

  /**
   * @description find any locked device for user
   */
  async findAnyLockedDevice(userId: string) {
    return this.UserDeviceModel.findOne({
      userId: new Types.ObjectId(userId),
      locked: true,
    })
  }

  /**
   * @description find locked device by user and device id
   */
  async findLockedDevice(userId: string, deviceId: string) {
    return this.UserDeviceModel.findOne({
      userId: new Types.ObjectId(userId),
      deviceId,
      locked: true,
    })
  }

  /**
   * @description update trusted status for device
   */
  async updateTrustedStatus(
    userId: string,
    deviceId: string,
    trusted: boolean,
    trustedExpiredAt: Date | null,
    dbSession: ClientSession,
  ) {
    const doc = await this.findByUserAndDevice(userId, deviceId, dbSession)
    if (!doc)
      return false

    doc.trusted = trusted
    doc.trustedExpiredAt = trustedExpiredAt!
    await doc.save({ session: dbSession })
    return true
  }

  /**
   * @description find trusted device for user
   */
  async findTrustedDevice(userId: string, deviceId: string, dbSession?: ClientSession) {
    return this.UserDeviceModel.findOne({
      userId: new Types.ObjectId(userId),
      deviceId,
      trusted: true,
    }).session(dbSession!)
  }
}

import type { EntityManager } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { isNil } from 'lodash'
import { DataSource } from 'typeorm'
import { SysUserDeviceEntity } from '../entity/user-device.entity'

export interface IUserDevicePopulatedUser {
  id: string
  userName: string | null
  nickName: string | null
}

/**
 * B6 迁移：Mongo model → PG 命名连接 DataSource。
 *
 * - **deviceId 是业务键**（Q5 定案）：本表 device_id 存的是 sys_device.device_id
 *   （字符串业务键，FK → sys_device(device_id)），全部引用与校验按业务键走，不是行 id；
 * - user_id 是 PG uuid（FK → sys_user(id)）：B7 user 迁移 + ETL 前为空数据窗口
 *   （phase3-plan §5），populated_user 一律查 PG 侧 sys_user 同源表；
 * - 事务句柄 `dbSession?: ClientSession` → `em?: EntityManager`（缺省连接级 manager）。
 */
@Injectable()
export class SysUserDeviceRepositoryService {
  private readonly logger = new Logger(SysUserDeviceRepositoryService.name)

  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) { }

  private getManager(em?: EntityManager) {
    return em ?? this.dataSource.manager
  }

  private getRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysUserDeviceEntity)
  }

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
  getIsDeviceExpired(trustedExpiredAt?: Date | null) {
    if (!trustedExpiredAt) {
      return false
    }
    return AppDayjs(trustedExpiredAt).isBefore()
  }

  /**
   * @description check if device is trusted and valid
   */
  isTrustedAndValid(device: SysUserDeviceEntity | null): boolean {
    if (!device) {
      return false
    }

    if (!device.trusted) {
      return false
    }

    if (device.lastActiveAt === null) {
      return false
    }

    // check if trusted expired
    if (AppDayjs(device.trustedExpiredAt).isBefore(AppDayjs())) {
      return false
    }

    return true
  }

  /**
   * @description check if device is inactive for specified days
   */
  getIsDeviceInactive(lastActiveAt?: Date | null, offsetDays = 7) {
    // If no last active time, consider it inactive
    if (!lastActiveAt) {
      return true
    }

    // Check if the cutoff time (X days ago) is after the last active time
    // If true, it means the device hasn't been active for X days
    return AppDayjs().subtract(offsetDays, 'day').isAfter(lastActiveAt)
  }

  /**
   * @description find all devices for current user
   */
  async findAllDevicesForCurrentUser(userId: string, em?: EntityManager) {
    return this.getRepository(em).find({ where: { userId } })
  }

  /**
   * @description update user device name
   * （Mongo 版 findOneAndUpdate：命中即改，未命中返回 null，不抛）
   */
  async updateUserDeviceName(
    userId: string,
    deviceId: string,
    deviceName: string,
    em?: EntityManager,
  ) {
    const repository = this.getRepository(em)

    const target = await repository.findOne({ where: { userId, deviceId } })
    if (!target) {
      return null
    }

    target.deviceName = deviceName
    return repository.save(target)
  }

  /**
   * @description find all devices by device id with populated user
   * （Mongo 版 populate(USER, select userName nickName) → PG 侧按 user_id 批查 sys_user
   * 同源表并回 populated_user；B7 注册 SysUserEntity 后可换实体 JOIN）
   */
  async findAllUserInCurrentDevice(deviceId: string, em?: EntityManager) {
    const rows = await this.getRepository(em).find({
      where: { deviceId },
      order: { lastActiveAt: 'DESC' },
    })

    const userIds = [...new Set(rows.map(r => r.userId))]
    let users: IUserDevicePopulatedUser[] = []
    if (userIds.length > 0) {
      const rawUsers = await this.getManager(em)
        .createQueryBuilder()
        .select('u.id', 'id')
        .addSelect('u.user_name', 'userName')
        .addSelect('u.nick_name', 'nickName')
        .from('sys_user', 'u')
        .where('u.id IN (:...userIds)', { userIds })
        .getRawMany<{ id: string, userName: string | null, nickName: string | null }>()
      users = rawUsers
    }

    return rows.map((row) => {
      const populated_user = users.find(u => u.id === row.userId) ?? null
      return Object.assign(row, { populated_user })
    })
  }

  /**
   * @description update last active at for device
   *
   * Mongo 版原样镜像（含 isNil 分支的原始语义，勿"修正"）：userId 为 nil 时走
   * `{ userId, deviceId }` 分支 —— Mongo 里 `new Types.ObjectId(undefined)` 生成一个
   * 全新 id 恒匹配空集；PG 侧等价用一次性随机 uuid。userId 非 nil 时只按 deviceId
   * 更新命中到的第一行（findOneAndUpdate 单行语义）。
   */
  async updateUserDeviceLastActiveAt(deviceId: string, userId?: string, em?: EntityManager) {
    const repository = this.getRepository(em)

    const where = isNil(userId) ? { userId: randomUUID(), deviceId } : { deviceId }

    const target = await repository.findOne({ where })
    if (!target) {
      return null
    }

    target.lastActiveAt = AppDayjs().toDate()
    return repository.save(target)
  }

  /**
   * @description upsert device for user
   */
  async upsertDevice(
    userId: string,
    deviceId: string,
    deviceName: string,
    em?: EntityManager,
  ) {
    const oldDevice = await this.findByUserAndDevice(userId, deviceId, em)
    if (oldDevice) {
      return oldDevice
    }

    const repository = this.getRepository(em)
    return repository.save(repository.create({ userId, deviceId, deviceName }))
  }

  /**
   * @description find device by user and device id
   */
  async findByUserAndDevice(
    userId: string,
    deviceId: string,
    em?: EntityManager,
  ) {
    return this.getRepository(em).findOne({ where: { userId, deviceId } })
  }

  /**
   * @description update lock status for specific device
   */
  async updateLockStatusForThisUserAndThisDevice(
    userId: string,
    deviceId: string,
    locked: boolean,
    em?: EntityManager,
  ) {
    const repository = this.getRepository(em)

    const doc = await this.findByUserAndDevice(userId, deviceId, em)
    if (!doc) {
      return false
    }

    doc.locked = locked
    await repository.save(doc)
    return true
  }

  /**
   * @description update lock status for all user devices
   * （Mongo 版 updateMany({ userId, locked: { $ne: locked } }, { locked }) → QueryBuilder）
   */
  async updateLockStatusForAllDevices(
    userId: string,
    locked: boolean,
    em?: EntityManager,
  ) {
    await this.getRepository(em)
      .createQueryBuilder()
      .update(SysUserDeviceEntity)
      .set({ locked })
      .where('user_id = :userId AND locked <> :locked', { userId, locked })
      .execute()
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
    return this.getRepository().findOne({
      where: { userId, locked: true },
    })
  }

  /**
   * @description find locked device by user and device id
   */
  async findLockedDevice(userId: string, deviceId: string) {
    return this.getRepository().findOne({
      where: { userId, deviceId, locked: true },
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
    em?: EntityManager,
  ) {
    const repository = this.getRepository(em)

    const doc = await this.findByUserAndDevice(userId, deviceId, em)
    if (!doc) {
      return false
    }

    doc.trusted = trusted
    doc.trustedExpiredAt = trustedExpiredAt!
    await repository.save(doc)
    return true
  }

  /**
   * @description find trusted device for user
   */
  async findTrustedDevice(userId: string, deviceId: string, em?: EntityManager) {
    return this.getRepository(em).findOne({
      where: { userId, deviceId, trusted: true },
    })
  }
}

import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { AppTechCacheDeviceService } from '@walnut-server/cache'
import { AppTechCryptoService } from '@walnut-server/crypto'
import { runAfterCommit, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionNotFound } from '@walnut-server/exceptions'

import { SharedIpService } from '@walnut-server/ip'
import { SharedLocationDTO } from '@walnut-server/list'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { DataSource } from 'typeorm'
import { SysDeviceEntity } from '../entity/device.entity'

/**
 * B6 迁移：Mongo model → PG 命名连接 DataSource。全部查询按**业务键 device_id**走
 * （Q5 定案：user_device / auth_refresh_token 引用的是 sys_device.device_id，不是行 id），
 * 事务句柄 `dbSession?: ClientSession` → `em?: EntityManager`（取自 WalnutTxContext.em，
 * 缺省连接级 manager，语义同 Mongo 版可选 session）。
 */
@Injectable()
export class SysDeviceRepositoryService {
  private readonly logger = new Logger(SysDeviceRepositoryService.name)

  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,

    private readonly cacheDeviceService: AppTechCacheDeviceService,
    private readonly cryptoService: AppTechCryptoService,
    private readonly sharedIpService: SharedIpService,
  ) { }

  private getRepository(em?: EntityManager) {
    return (em ?? this.dataSource.manager).getRepository(SysDeviceEntity)
  }

  /**
   * @description get device id by fingerprint
   */
  getDeviceIdByFingerprint(visitorId: string) {
    return this.cryptoService.hashDeviceFingerprint(visitorId)
  }

  /**
   * @description get all active devices
   */
  async getAllActiveDevices() {
    return this.getRepository().find({ where: { active: true } })
  }

  /**
   * @description 标记设备行为 stale（**不再物理删行**，拍板-5）
   *
   * 原实现是删行（findOneAndDelete 语义）：行一没，cookie 还在的浏览器就永久 40605
   * （DeviceGuard 回源查不到），而 banned / locked 也随行一起消失 —— 「等 cron 删行」
   * 成了绕过封禁的免费路径。现在只写 `stale = true` + `active = false`：
   * - 行与 cookie 生命周期解耦，guard 照常命中 ⇒ 不再造出 40605 死胡同；
   * - banned / locked 原地保留 ⇒ 删行不再是封禁的逃生门；
   * - `stale` 不参与鉴权，重新 initial 时由 device.service 写回 false。
   *
   * @returns 标记**前**的快照（调用方只关心「有没有打过标记」，无行返回 null）
   */
  async markDeviceStale(deviceId: string) {
    const repository = this.getRepository()

    const target = await repository.findOne({ where: { deviceId } })
    if (!target) {
      return null
    }

    const snapshot = { ...target }

    target.stale = true
    target.active = false

    const saved = await repository.save(target)

    // 行还在、只是 stale：缓存回写新状态（不再 del —— del 会让下一次请求回源，多一跳）
    await this.cacheDeviceService.setSysDeviceCache(saved)

    return snapshot
  }

  /**
   * @description get device name by device id
   */
  async getDeviceNameByDeviceId(deviceId: string, em?: EntityManager) {
    const device = await this.getRepository(em).findOne({ where: { deviceId } })
    return device?.deviceName as string
  }

  /**
   * @description find device by device id
   */
  async findDeviceByDeviceId(deviceId: string, em?: EntityManager) {
    return this.getRepository(em).findOne({ where: { deviceId } })
  }

  /**
   * @description find device by device id and update
   * （Mongo 版 findOneAndUpdate + returnDocument: 'after' → 找到即赋值保存，返回更新后行）
   */
  async findDeviceByDeviceIdAndUpdate(deviceId: string, update: Partial<SysDeviceEntity>, em?: EntityManager) {
    const repository = this.getRepository(em)

    const target = await repository.findOne({ where: { deviceId } })
    if (!target) {
      return null
    }

    Object.assign(target, update)
    return repository.save(target)
  }

  /**
   * @description get device location history
   */
  async getDeviceLocationHistory(deviceId: string) {
    const device = await this.getRepository().findOne({ where: { deviceId } })
    return device?.locationHistory || []
  }

  /**
   * @description get device current location
   */
  async getDeviceCurrentLocation(deviceId: string) {
    const device = await this.getRepository().findOne({ where: { deviceId } })
    return device?.locationInfo || null
  }

  /**
   * 获取设备创建时间距离当前时间的天数
   * @param createdAt 设备创建时间
   * @returns 距离当前时间的天数
   */
  getDeviceCreatedDays(createdAt: Date) {
    return AppDayjs().diff(createdAt, 'day')
  }

  /**
   * 更新设备 IP 和位置信息
   *
   * 逻辑：
   * 1. 同时更新 ipHistory 和 locationHistory
   * 2. 保持两者同步（相同的索引对应相同的记录）
   * 3. 最多保留 5 条历史记录
   * 4. 更新 locationInfo 为最新位置
   *
   * @param deviceId - Device ID
   * @param ip - 新的 IP address
   */
  async updateIpAndLocation(
    deviceId: string,
    ip: string,
    em?: EntityManager,
  ) {
    const repository = this.getRepository(em)

    const device = await repository.findOne({ where: { deviceId } })
    const responseLocation = await this.sharedIpService.getLocationInfoFromFreeAPI(ip)

    const location: SharedLocationDTO = {
      country: responseLocation.country,
      region: responseLocation.region,
      city: responseLocation.city,
    }

    if (!device) {
      throw new WalnutAdminExceptionNotFound()
    }

    // 检查 IP 是否已存在
    const existingIndex = device.ipHistory.indexOf(ip)

    if (existingIndex !== -1) {
      // IP 已存在，更新对应的位置信息和时间戳
      device.locationHistory[existingIndex] = {
        ip,
        location: location as unknown as Record<string, unknown>,
        timestamp: AppDayjs().valueOf(),
      }
    }
    else {
      // 新 IP，添加到历史记录
      device.ipHistory.push(ip)
      device.locationHistory.push({
        ip,
        location: location as unknown as Record<string, unknown>,
        timestamp: AppDayjs().valueOf(),
      })

      // 保持最多 5 条记录
      if (device.ipHistory.length > 5) {
        device.ipHistory.shift()
        device.locationHistory.shift()
      }
    }

    // 更新当前位置信息为最新的
    device.locationInfo = location as unknown as Record<string, unknown>
    device.ip = ip

    await repository.save(device)

    // set device cache after transaction commit
    await runAfterCommit(async () => {
      await this.cacheDeviceService.setSysDeviceCache(device)
    })

    return true
  }
}

import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { runAfterCommit, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionNotFound } from '@walnut-server/exceptions'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { DataSource } from 'typeorm'

import { SharedLocationDTO } from '@/common/dto/shared.dto'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { AppTechCacheDeviceService } from '@/modules/techniques/cache/service/cache.device'
import { AppTechCryptoService } from '@/modules/techniques/crypto/crypto.service'
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
   * @description delete non-monitor user device
   */
  async deleteNonMonitorUserDevice(deviceId: string) {
    await this.cacheDeviceService.delSysDeviceCache(deviceId)

    // findOneAndDelete → 找到即删，返回删除前快照（remove() 会就地清空生成列），无则 null
    const target = await this.getRepository().findOne({ where: { deviceId } })
    if (!target) {
      return null
    }

    const snapshot = { ...target }
    await this.getRepository().remove(target)
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

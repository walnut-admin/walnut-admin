import { Injectable, Logger } from '@nestjs/common'
import { runAfterCommit, WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminExceptionNotFound } from '@walnut-server/exceptions'
import { AppDayjs } from '@walnut-server/utils/dayjs'

import { ClientSession } from 'mongoose'
import { SharedLocationDTO } from '@/common/dto/shared.dto'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { AppTechCacheDeviceService } from '@/modules/techniques/cache/service/cache.device'
import { AppTechCryptoService } from '@/modules/techniques/crypto/crypto.service'
import { ISysDeviceDocument, ISysDeviceModel } from '../schema/device.schema'

@Injectable()
export class SysDeviceRepositoryService {
  private readonly logger = new Logger(SysDeviceRepositoryService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_DEVICE)
    private readonly DeviceModel: ISysDeviceModel,

    private readonly cacheDeviceService: AppTechCacheDeviceService,
    private readonly cryptoService: AppTechCryptoService,
    private readonly sharedIpService: SharedIpService,
  ) { }

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
    return this.DeviceModel.find({ active: true })
  }

  /**
   * @description delete non-monitor user device
   */
  async deleteNonMonitorUserDevice(deviceId: string) {
    await this.cacheDeviceService.delSysDeviceCache(deviceId)
    return this.DeviceModel.findOneAndDelete({ deviceId })
  }

  /**
   * @description get device name by device id
   */
  async getDeviceNameByDeviceId(deviceId: string, dbSession: ClientSession) {
    const device = await this.DeviceModel.findOne({ deviceId }).session(dbSession)
    return device?.deviceName as string
  }

  /**
   * @description find device by device id
   */
  async findDeviceByDeviceId(deviceId: string, dbSession?: ClientSession) {
    return this.DeviceModel.findOne({ deviceId }).session(dbSession!)
  }

  /**
   * @description find device by device id and update
   */
  async findDeviceByDeviceIdAndUpdate(deviceId: string, update: Partial<ISysDeviceDocument>, dbSession?: ClientSession) {
    return this.DeviceModel.findOneAndUpdate({ deviceId }, update, { returnDocument: 'after' }).session(dbSession!)
  }

  /**
   * @description get device location history
   */
  async getDeviceLocationHistory(deviceId: string) {
    const device = await this.DeviceModel
      .findOne({ deviceId })
      .select('locationHistory')
      .exec()
    return device?.locationHistory || []
  }

  /**
   * @description get device current location
   */
  async getDeviceCurrentLocation(deviceId: string) {
    const device = await this.DeviceModel
      .findOne({ deviceId })
      .select('locationInfo')
      .exec()
    return device?.locationInfo || null
  }

  /**
   * 获取设备创建时间距离当前时间的天�?
   * @param createdAt 设备创建时间
   * @returns 距离当前时间的天�?
   */
  getDeviceCreatedDays(createdAt: Date) {
    return AppDayjs().diff(createdAt, 'day')
  }

  /**
   * 更新设备 IP 和位置信�?
   *
   * 逻辑�?
   * 1. 同时更新 ipHistory �?locationHistory
   * 2. 保持两者同步（相同的索引对应相同的记录�?
   * 3. 最多保�?5 条历史记�?
   * 4. 更新 locationInfo 为最新位�?
   *
   * @param deviceId - Device ID
   * @param ip - 新的 IP address
   */
  async updateIpAndLocation(
    deviceId: string,
    ip: string,
    dbSession?: ClientSession,
  ) {
    const device = await this.DeviceModel.findOne({ deviceId }).session(dbSession!)
    const responseLocation = await this.sharedIpService.getLocationInfoFromFreeAPI(ip)

    const location: SharedLocationDTO = {
      country: responseLocation.country,
      region: responseLocation.region,
      city: responseLocation.city,
    }

    if (!device) {
      throw new WalnutAdminExceptionNotFound()
    }

    // 检�?IP 是否已存�?
    const existingIndex = device.ipHistory.indexOf(ip)

    if (existingIndex !== -1) {
      // IP 已存在，更新对应的位置信息和时间�?
      device.locationHistory[existingIndex] = {
        ip,
        location,
        timestamp: AppDayjs().valueOf(),
      }
    }
    else {
      // �?IP，添加到历史记录
      device.ipHistory.push(ip)
      device.locationHistory.push({
        ip,
        location,
        timestamp: AppDayjs().valueOf(),
      })

      // 保持最�?5 条记�?
      if (device.ipHistory.length > 5) {
        device.ipHistory.shift()
        device.locationHistory.shift()
      }
    }

    // 更新当前位置信息为最新的
    device.locationInfo = location
    device.ip = ip

    await device.save({ session: dbSession })

    // set device cache after transaction commit
    await runAfterCommit(async () => {
      await this.cacheDeviceService.setSysDeviceCache(device)
    })

    return true
  }
}

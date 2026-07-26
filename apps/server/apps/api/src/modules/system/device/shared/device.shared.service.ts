import type { ClientSession } from 'mongoose'
import { Injectable } from '@nestjs/common'
import { runAfterCommit } from '@walnut-server/db'
import { SharedIpLocationHistoryDTO, SharedLocationDTO } from '@/common/dto/shared.dto'
import { AppTechCacheDeviceService } from '@/modules/techniques/cache/service/cache.device'
import { SysDeviceRepositoryService } from '../repo/device.repo.service'

@Injectable()
export class SysDeviceSharedService {
  constructor(
    private readonly sysDeviceRepoService: SysDeviceRepositoryService,
    private readonly cacheDeviceService: AppTechCacheDeviceService,
  ) { }

  /**
   * @description update device active status
   */
  async updateDeviceActive(deviceId: string, active: boolean, dbSession?: ClientSession) {
    const target = await this.sysDeviceRepoService.findDeviceByDeviceIdAndUpdate(
      deviceId,
      { active },
      dbSession,
    )

    if (!target) {
      return false
    }

    // update cache after transaction commit
    await runAfterCommit(async () => {
      await this.cacheDeviceService.setSysDeviceCache(target)
    })

    return target
  }

  /**
   * 获取设备�?IP 位置历史
   */
  async getIpLocationHistory(
    deviceId: string,
  ): Promise<SharedIpLocationHistoryDTO[]> {
    return this.sysDeviceRepoService.getDeviceLocationHistory(deviceId)
  }

  /**
   * 获取设备当前位置信息
   */
  async getCurrentLocation(deviceId: string): Promise<SharedLocationDTO | null> {
    return this.sysDeviceRepoService.getDeviceCurrentLocation(deviceId)
  }

  /**
   * 检查设备是否有位置跳变（异地登录检测）
   *
   * @param deviceId - Device ID
   * @param threshold - 位置变化阈值（默认：国家不同即为跳变）
   * @returns 是否发生位置跳变
   */
  async hasLocationJump(
    deviceId: string,
    threshold: 'country' | 'region' | 'city' = 'country',
  ): Promise<{
    hasJump: boolean
    from?: SharedLocationDTO
    to?: SharedLocationDTO
  }> {
    const history = await this.getIpLocationHistory(deviceId)

    if (history.length < 2) {
      return { hasJump: false }
    }

    // 比较最后两次位�?
    const latest = history.at(-1) as SharedIpLocationHistoryDTO
    const previous = history[history.length - 2]

    let hasJump = false

    switch (threshold) {
      case 'country':
        hasJump = latest.location.country !== previous.location.country
        break
      case 'region':
        hasJump
          = latest.location.country !== previous.location.country
            || latest.location.region !== previous.location.region
        break
      case 'city':
        hasJump
          = latest.location.country !== previous.location.country
            || latest.location.region !== previous.location.region
            || latest.location.city !== previous.location.city
        break
    }

    return {
      hasJump,
      from: hasJump ? previous.location : undefined,
      to: hasJump ? latest.location : undefined,
    }
  }
}

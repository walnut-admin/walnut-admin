import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { runAfterCommit } from '@walnut-server/db'
import { AppTechCacheDeviceService } from '@/modules/techniques/cache/service/cache.device'
import { IDeviceLocationHistoryItem, SysDeviceEntity } from '../entity/device.entity'
import { SysDeviceRepositoryService } from '../repo/device.repo.service'

/**
 * B6 迁移：事务句柄签名 `dbSession?: ClientSession` → `em?: EntityManager`（纯透传）；
 * 位置历史的元素形状随 PG jsonb 列换成实体的 IDeviceLocationHistoryItem。
 */
@Injectable()
export class SysDeviceSharedService {
  constructor(
    private readonly sysDeviceRepoService: SysDeviceRepositoryService,
    private readonly cacheDeviceService: AppTechCacheDeviceService,
  ) { }

  /**
   * @description update device active status
   */
  async updateDeviceActive(deviceId: string, active: boolean, em?: EntityManager) {
    const target = await this.sysDeviceRepoService.findDeviceByDeviceIdAndUpdate(
      deviceId,
      { active },
      em,
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
   * 获取设备的 IP 位置历史
   */
  async getIpLocationHistory(
    deviceId: string,
  ): Promise<IDeviceLocationHistoryItem[]> {
    return this.sysDeviceRepoService.getDeviceLocationHistory(deviceId)
  }

  /**
   * 获取设备当前位置信息
   */
  async getCurrentLocation(deviceId: string): Promise<SysDeviceEntity['locationInfo']> {
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
    from?: IDeviceLocationHistoryItem['location']
    to?: IDeviceLocationHistoryItem['location']
  }> {
    const history = await this.getIpLocationHistory(deviceId)

    if (history.length < 2) {
      return { hasJump: false }
    }

    // 比较最后两次位置
    const latest = history.at(-1) as IDeviceLocationHistoryItem
    const previous = history[history.length - 2]

    const latestLocation = (latest.location ?? {})
    const previousLocation = (previous.location ?? {})

    let hasJump = false

    switch (threshold) {
      case 'country':
        hasJump = latestLocation.country !== previousLocation.country
        break
      case 'region':
        hasJump
          = latestLocation.country !== previousLocation.country
            || latestLocation.region !== previousLocation.region
        break
      case 'city':
        hasJump
          = latestLocation.country !== previousLocation.country
            || latestLocation.region !== previousLocation.region
            || latestLocation.city !== previousLocation.city
        break
    }

    return {
      hasJump,
      from: hasJump ? previous.location : undefined,
      to: hasJump ? latest.location : undefined,
    }
  }
}

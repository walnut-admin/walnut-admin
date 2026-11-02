import type { IIdentityDeviceRow, IIdentityDeviceService } from '@walnut-server/identity'
import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { SysDeviceRepositoryService } from './repo/device.repo.service'
import { SysDeviceSharedService } from './shared/device.shared.service'

/**
 * 身份内核的设备注册表端口实现（libs 解耦批 6）。
 *
 * user_device（bind 取设备名 / 列表取 deviceInfo+locationInfo / cron 清理失效设备）
 * 原先直接 import app 的 SysDeviceRepositoryService / SysDeviceSharedService —— 内核
 * 只保留 `IIdentityDeviceService` 窄接口（5 个方法），本桥接类在 libs/system 内完成委托。
 *
 * 绑定在 SysDeviceSharedModule（@Global）：libs/identity 的模块无需 import system 模块。
 */
@Injectable()
export class IdentityDeviceBridge implements IIdentityDeviceService {
  constructor(
    private readonly repo: SysDeviceRepositoryService,
    private readonly shared: SysDeviceSharedService,
  ) {}

  async findDeviceByDeviceId(deviceId: string, em?: EntityManager): Promise<IIdentityDeviceRow | null> {
    return this.repo.findDeviceByDeviceId(deviceId, em)
  }

  async getDeviceNameByDeviceId(deviceId: string, em?: EntityManager): Promise<string> {
    return this.repo.getDeviceNameByDeviceId(deviceId, em)
  }

  async getAllActiveDevices(): Promise<IIdentityDeviceRow[]> {
    return this.repo.getAllActiveDevices()
  }

  // 拍板-5：端口语义从「删行」改为「打 stale 标记」—— 行与 cookie 生命周期解耦，
  // banned / locked 不再能被「等 cron 删行」洗掉。
  async markDeviceStale(deviceId: string): Promise<IIdentityDeviceRow | null> {
    return this.repo.markDeviceStale(deviceId)
  }

  async updateDeviceActive(deviceId: string, active: boolean, em?: EntityManager): Promise<boolean> {
    // shared 层返回 false（失败）或更新后的实体（成功）；端口口径是 boolean，false/真值收敛
    const updated = await this.shared.updateDeviceActive(deviceId, active, em)
    return updated !== false
  }
}

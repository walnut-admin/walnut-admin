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
 * 只保留 `IIdentityDeviceService` 窄接口（5 个方法），本桥接类在 app 组合根完成委托。
 *
 * 绑定在 SysDeviceSharedModule（@Global）：libs/identity 的模块无需 import app 模块。
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

  async deleteNonMonitorUserDevice(deviceId: string): Promise<IIdentityDeviceRow | null> {
    return this.repo.deleteNonMonitorUserDevice(deviceId)
  }

  async updateDeviceActive(deviceId: string, active: boolean, em?: EntityManager): Promise<boolean> {
    // shared 层返回 false（失败）或更新后的实体（成功）；端口口径是 boolean，false/真值收敛
    const updated = await this.shared.updateDeviceActive(deviceId, active, em)
    return updated !== false
  }
}

import { Injectable } from '@nestjs/common'

import { SysDeviceRepositoryService } from '../../device/repo/device.repo.service'
import {
  SysLogOperateDTO,
  SysLogOperateDTOListRequest,
} from './dto/log.operate.dto'
import { SysLogOperateBasicRepository } from './log.operate.basic.repository'
import { SysLogOperateRepoService } from './repo/log.operate.repo.service'

/**
 * Log Operate Service
 *
 * This service has 1:1 mapping with controller endpoints.
 * NO direct Model usage - all data access through Repository/Repo Service layer.
 *
 * B8 迁移（service 层，B1 模板）：数据访问全部走 PG 版仓库；`getDeviceByLogOperateId`
 * 的 Mongo virtual populate（deviceId 业务键反查 sys_device）改查 PG 同源表 —— 注入
 * @Global 的 SysDeviceRepositoryService（B7a deleted.service read populate 摘除同款手法）。
 */
@Injectable()
export class SysLogOperateService {
  constructor(
    private readonly logOperateBasicRepo: SysLogOperateBasicRepository,
    private readonly logOperateRepoService: SysLogOperateRepoService,
    private readonly sysDeviceRepoService: SysDeviceRepositoryService,
  ) {}

  /**
   * @description create operate log (controller: create)
   */
  async create(dto: SysLogOperateDTO) {
    return this.logOperateRepoService.create(dto)
  }

  /**
   * @description read operate log (controller: read)
   */
  async read(id: string) {
    return this.logOperateBasicRepo.readById(id)
  }

  /**
   * @description list operate logs (controller: list)
   *
   * Mongo 版 list 带 $project 只出 9 列；PG 版走基类默认列表（列白名单 +
   * COUNT(*) OVER() 单趟），出参全列由响应 DTO 的 Expose 面收口（快照列 /
   * Mongo _id 已在 Safe 层剔除）。
   */
  async list(params: SysLogOperateDTOListRequest) {
    return this.logOperateBasicRepo.list(params)
  }

  /**
   * @description get snapshot (controller: getSnapshot)
   */
  async getSnapshot(id: string) {
    return this.logOperateBasicRepo.readById(id)
  }

  /**
   * @description get device by log operate id (controller: getDeviceByLogOperateId)
   *
   * 松引用反查：deviceId 是业务键（sys_device.device_id 全表唯一，Q5 定案），
   * 找不到设备行返回 null（Mongo 版 populated_device 为 null 时 controller 侧
   * `.toObject()` 直接 TypeError 500，这里收敛为受控空值）。
   */
  async getDeviceByLogOperateId(id: string) {
    const target = await this.logOperateBasicRepo.readById(id)

    return target.deviceId !== null
      ? this.sysDeviceRepoService.findDeviceByDeviceId(target.deviceId)
      : null
  }
}

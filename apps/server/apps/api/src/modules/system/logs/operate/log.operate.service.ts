import { Injectable } from '@nestjs/common'
import { WalnutDBVirtualName } from '@walnut-server/db'

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
 */
@Injectable()
export class SysLogOperateService {
  constructor(
    private readonly logOperateBasicRepo: SysLogOperateBasicRepository,
    private readonly logOperateRepoService: SysLogOperateRepoService,
  ) {}

  /**
   * @description create operate log (controller: create)
   */
  async create(dto: Omit<SysLogOperateDTO, '_id'>) {
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
   */
  async list(params: SysLogOperateDTOListRequest) {
    return this.logOperateBasicRepo.list(params, [
      {
        $project: {
          title: 1,
          actionType: 1,
          operation: 1,
          method: 1,
          userName: 1,
          ip: 1,
          statusCode: 1,
          success: 1,
          operatedAt: 1,
        },
      },
    ])
  }

  /**
   * @description get snapshot (controller: getSnapshot)
   */
  async getSnapshot(id: string) {
    return this.logOperateBasicRepo.readById(id)
  }

  /**
   * @description get device by log operate id (controller: getDeviceByLogOperateId)
   */
  async getDeviceByLogOperateId(id: string) {
    const target = await this.logOperateBasicRepo.readById(id)

    const populated = await target.populate({
      path: WalnutDBVirtualName.DEVICE,
      select: 'deviceId deviceName',
    })

    return populated.populated_device!
  }
}

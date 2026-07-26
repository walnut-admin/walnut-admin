import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { ClientSession } from 'mongoose'

import { SysLogOperateDTO } from '../dto/log.operate.dto'
import { ISysLogOperateModel } from '../schema/log.operate.schema'

/**
 * Log Operate Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 */
@Injectable()
export class SysLogOperateRepoService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_LOG_OPERATE)
    private readonly LogOperateModel: ISysLogOperateModel,
  ) {}

  /**
   * @description create operate log
   */
  async create(dto: Omit<SysLogOperateDTO, '_id'>, dbSession?: ClientSession) {
    if (dbSession) {
      const [created] = await this.LogOperateModel.create([dto], { session: dbSession })
      return created
    }

    return this.LogOperateModel.create(dto)
  }
}

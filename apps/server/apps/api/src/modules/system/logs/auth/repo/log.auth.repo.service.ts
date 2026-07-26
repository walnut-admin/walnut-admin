import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { ClientSession } from 'mongoose'

import { SysLogAuthDTO } from '../dto/log.auth.dto'
import { ISysLogAuthModel } from '../schema/log.auth.schema'

/**
 * Log Auth Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 */
@Injectable()
export class SysLogAuthRepoService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_LOG_AUTH)
    private readonly LogAuthModel: ISysLogAuthModel,
  ) {}

  /**
   * @description create auth log
   */
  async create(dto: Omit<SysLogAuthDTO, '_id'>, dbSession?: ClientSession) {
    if (dbSession) {
      const [created] = await this.LogAuthModel.create([dto], { session: dbSession })
      return created
    }

    return this.LogAuthModel.create(dto)
  }
}

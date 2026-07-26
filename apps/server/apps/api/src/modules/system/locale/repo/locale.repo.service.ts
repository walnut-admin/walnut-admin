import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { ClientSession, PipelineStage } from 'mongoose'

import { ISysLocaleModel } from '../schema/locale.schema'

/**
 * Locale Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 */
@Injectable()
export class SysLocaleRepoService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_LOCALE)
    private readonly localeModel: ISysLocaleModel,
  ) {}

  /**
   * @description find locales by key
   */
  async findByKey(key: string, dbSession?: ClientSession) {
    return this.localeModel.find({ key }).session(dbSession!).exec()
  }

  /**
   * @description check if key exists
   */
  async existsByKey(key: string, dbSession?: ClientSession) {
    return this.localeModel.exists({ key }).session(dbSession!).exec()
  }

  /**
   * @description aggregate for list
   */
  async aggregateList(pipeline: PipelineStage[], dbSession?: ClientSession) {
    return this.localeModel.aggregate(pipeline).session(dbSession!)
  }
}

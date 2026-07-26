import type { ClientSession } from 'mongoose'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppConfig } from '@walnut-server/const/app/config'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { Types } from 'mongoose'

import { SysDeletedDTOSafe } from '../dto/deleted.dto'
import { ISysDeletedModel } from '../schema/deleted.schema'

/**
 * Deleted Repository Service
 *
 * Simple CRUD for cross-module access.
 * This service is @Global() to avoid circular dependencies.
 */
@Injectable()
export class SysDeletedRepoService {
  private readonly logger = new Logger(SysDeletedRepoService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_DELETED)
    private readonly DeletedModel: ISysDeletedModel,
  ) {}

  /**
   * @description create soft delete record
   */
  async createSoftDelete(payload: Omit<SysDeletedDTOSafe, '_id'>, dbSession?: ClientSession) {
    if (dbSession) {
      const [created] = await this.DeletedModel.create([payload], { session: dbSession })
      return created
    }

    return this.DeletedModel.create(payload)
  }

  // bind the log operate id for the deleted document
  async updateDeletedWithLogOperateId(payload: { logOperateId: string, deletedId: string }) {
    const deleted = await this.DeletedModel.findOne({ deletedId: new Types.ObjectId(payload.deletedId) })
    if (!deleted) {
      this.logger.log('Log Operate Id Update Failed, no deleted document found')
      return null
    }

    deleted.logOperateId = new Types.ObjectId(payload.logOperateId)

    await deleted.save()
    return deleted
  }

  // same as above, but mulitple
  async updateDeletedManyWithLogOperateId(payload: { logOperateId: string, deletedIds: string }) {
    const deletedIdArr = payload.deletedIds.split(WalnutAdminConstAppConfig.idSeparator)

    const res: SysDeletedDTOSafe[] = []
    for (const id of deletedIdArr) {
      const deleted = await this.updateDeletedWithLogOperateId({ deletedId: id, logOperateId: payload.logOperateId })
      if (deleted) {
        res.push(deleted)
      }
    }
    return res
  }
}

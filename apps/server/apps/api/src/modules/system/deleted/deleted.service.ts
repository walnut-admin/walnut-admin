import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBCollectionName, WalnutDBInjectModel, WalnutDBModelName, WalnutDBVirtualName } from '@walnut-server/db'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { Recordable } from 'easy-fns-ts'
import { ClientSession, isObjectIdOrHexString, Types } from 'mongoose'
import { SysDeletedBasicRepository } from './deleted.basic.repository'
import { SysDeletedDTORecoverRequest, SystemDeletedDTOListRequest } from './dto/deleted.dto'
import { ISysDeletedModel } from './schema/deleted.schema'

@Injectable()
export class SysDeletedService {
  private readonly logger = new Logger(SysDeletedService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_DELETED)
    private readonly SysDeletedModel: ISysDeletedModel,

    private readonly deletedBasicRepo: SysDeletedBasicRepository,
  ) { }

  async read(id: string) {
    return (await this.deletedBasicRepo.readById(id)).populate({ path: WalnutDBVirtualName.USER, select: 'userName' })
  }

  async deleteRealMany(ids: string[]) {
    return this.deletedBasicRepo.deleteRealByIdMany(ids)
  }

  async list(payload: SystemDeletedDTOListRequest) {
    return this.deletedBasicRepo.list(payload, [
      {
        $lookup: {
          from: WalnutDBCollectionName.USER,
          localField: 'deletedBy',
          foreignField: '_id',
          as: WalnutDBVirtualName.USER,
          pipeline: [
            {
              $project: {
                userName: 1,
              },
            },
          ],
        },
      },
      { $unwind: { path: `$${WalnutDBVirtualName.USER}`, preserveNullAndEmptyArrays: true } },
    ])
  }

  // recover for me
  async recoverMine(payload: SysDeletedDTORecoverRequest, userId: string, dbSession: ClientSession) {
    const { _id, deletedId } = payload

    // find the deleted target
    const deleted = await this.SysDeletedModel.findOne({
      _id,
      deletedId: new Types.ObjectId(deletedId),
    }).session(dbSession)

    if (!deleted) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    if (deleted.deletedBy.toString() !== userId) {
      throw new WalnutAdminExceptionBadRequest()
    }

    const targetModel = this.SysDeletedModel.db.model(deleted.modelName)

    try {
      // recover to original collection
      await targetModel.create(JSON.parse(deleted.content) as Recordable, { session: dbSession })
    }
    catch (e) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.delete.recoverFail', _devMsg: e as string })
    }

    // delete from delete collection
    await this.SysDeletedModel.findByIdAndDelete(deleted._id).session(dbSession)

    return true
  }

  // recover for manage
  async recover(payload: SysDeletedDTORecoverRequest, dbSession: ClientSession) {
    const { _id, deletedId } = payload

    // find the deleted target
    const deleted = await this.SysDeletedModel.findById(_id).session(dbSession)

    if (!deleted) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    if (deleted.deletedId.toString() !== deletedId.toString()) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.delete.recoverFail', _devMsg: 'DeletedId Not Matched' })
    }

    const TargetModel = this.SysDeletedModel.db.model(deleted.modelName)

    try {
      const deletedContent = Object.fromEntries(Object.entries(JSON.parse(deleted.content) as Recordable).map(([k, v]) => {
        if (isObjectIdOrHexString(v)) {
          return [k, new Types.ObjectId(`${v}`)]
        }
        return [k, v]
      }))
      // recover to original collection
      await TargetModel.create(deletedContent, { session: dbSession })
    }
    catch (e) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.delete.recoverFail', _devMsg: e as string })
    }

    // delete from delete collection
    await this.SysDeletedModel.findByIdAndDelete(deleted._id).session(dbSession)

    return true
  }
}

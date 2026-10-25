import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBCollectionName, WalnutDBInjectModel, WalnutDBModelName, WalnutDBVirtualName } from '@walnut-server/db'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { Recordable } from 'easy-fns-ts'
import { ClientSession, isObjectIdOrHexString, Types } from 'mongoose'
import { SysUserRepositoryService } from '../user/repo/user.repo.service'
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
    private readonly sysUserRepoService: SysUserRepositoryService,
  ) { }

  async read(id: string) {
    const doc = await this.deletedBasicRepo.readById(id)

    // B7a：user 已迁 PG，Mongo 侧 SYS_USER 模型注册随之摘除 —— populate 读腿改查
    // PG sys_user 同源表（B5 usersCount 同款手法）。Mongo 窗口内 hex deletedBy 在
    // PG 侧查不到 → populated_user null（B9 归一）
    const deletedBy = doc.deletedBy?.toString() ?? ''
    const user = isObjectIdOrHexString(deletedBy) ? null : await this.sysUserRepoService.findUserByUserId(deletedBy)

    return Object.assign(doc.toObject(), {
      [WalnutDBVirtualName.USER]: user ? { id: user.id, userName: user.userName } : null,
    })
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
      // NOTICE: mongoose 9 的 create 单文档签名不收 options（第二参被当待建文档、session 被静默丢弃），带 session 必须传数组
      await targetModel.create([this.restoreSnapshotContent(deleted.content)], { session: dbSession })
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
      // recover to original collection
      // NOTICE: mongoose 9 的 create 单文档签名不收 options（第二参被当待建文档、session 被静默丢弃），带 session 必须传数组
      await TargetModel.create([this.restoreSnapshotContent(deleted.content)], { session: dbSession })
    }
    catch (e) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.delete.recoverFail', _devMsg: e as string })
    }

    // delete from delete collection
    await this.SysDeletedModel.findByIdAndDelete(deleted._id).session(dbSession)

    return true
  }

  /**
   * 快照 content（JSON 序列化产物）还原成待恢复文档。两条恢复路径（recover / recoverMine）
   * 必须走同一转换，语义是「恢复出的文档与被删时一致」：
   * - ObjectId 落进快照是 hex 字符串，恢复时转回 `Types.ObjectId`；
   * - 目标 schema 的 `@Prop({ type: Types.ObjectId })` 运行时是 Mixed（不 cast），写入什么存什么，
   *   不在这里显式转换的话 hex 字符串会原样入库。
   */
  private restoreSnapshotContent(content: string): Recordable {
    return Object.fromEntries(Object.entries(JSON.parse(content) as Recordable).map(([k, v]) => {
      if (isObjectIdOrHexString(v)) {
        return [k, new Types.ObjectId(`${v}`)]
      }
      return [k, v]
    }))
  }
}

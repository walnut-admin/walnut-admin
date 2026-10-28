import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutAdminConstAppConfig } from '@walnut-server/const/app/config'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { DataSource } from 'typeorm'
import { SysDeletedEntity } from '../entity/deleted.entity'

export interface ISysDeletedPgCreatePayload {
  /** 被删文档快照（jsonb 直存对象，原 stringify text 已升级，phase2 5.3） */
  content: Record<string, unknown>
  /** 恢复路由键，取 `WalnutModelName` 模型名 */
  modelName: string
  /** 纯记录字段：PG 表名 */
  collectionName: string
  /** 被删行 uuid */
  deletedId: string
  /** 删除者 uuid（松引用直传） */
  deletedBy: string
  /** 松引用，可空 */
  logOperateId?: string | null
}

/**
 * PostgreSQL 版回收站仓库（对应 Mongo 版 `SysDeletedRepoService`，B9 起唯一版本）。
 *
 * 服务 PG 软删路径（`pg-base.repository.ts` 的 deleteSoftById）与操作日志的
 * logOperateId 回填旁路；恢复 / 回收站读腿的编排收在 `SysDeletedService` +
 * `recover-registry.ts`。`em` 传自 `WalnutTxContext.em` 时，快照写入与原行删除
 * 同事务；缺省走连接级 manager（非事务路径）—— logOperateId 回填沿用旁路语义，
 * 刻意不收事务句柄（B8 同款裁定）。
 */
@Injectable()
export class SysDeletedPgRepoService {
  private readonly logger = new Logger(SysDeletedPgRepoService.name)

  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * @description create soft delete record
   */
  async createSoftDelete(payload: ISysDeletedPgCreatePayload, em?: EntityManager) {
    const manager = em ?? this.dataSource.manager
    const repository = manager.getRepository(SysDeletedEntity)

    // deleted_at 是普通列（B0a 实体注释：是否赋值由软删路径显式决定），这里即软删时刻
    const created = repository.create({
      content: payload.content,
      modelName: payload.modelName,
      collectionName: payload.collectionName,
      deletedId: payload.deletedId,
      deletedBy: payload.deletedBy,
      logOperateId: payload.logOperateId ?? null,
      deletedAt: new Date(),
    })

    return repository.save(created)
  }

  // bind the log operate id for the deleted document（uuid 直等更新 —— Mongo 版的
  // `new Types.ObjectId` 包装随双轨退役；未命中返回 null，与 Mongo 版一致）
  async updateDeletedWithLogOperateId(payload: { logOperateId: string, deletedId: string }) {
    const repository = this.getRepository()

    const res = await repository.update(
      { deletedId: payload.deletedId },
      { logOperateId: payload.logOperateId },
    )

    // affected 为 null/undefined 视作未命中（驱动缺省形态一并收口）
    if ((res.affected ?? 0) === 0) {
      this.logger.log('Log Operate Id Update Failed, no deleted document found')
      return null
    }

    return repository.findOne({ where: { deletedId: payload.deletedId } })
  }

  // same as above, but mulitple
  async updateDeletedManyWithLogOperateId(payload: { logOperateId: string, deletedIds: string }) {
    const deletedIdArr = payload.deletedIds.split(WalnutAdminConstAppConfig.idSeparator)

    const res: SysDeletedEntity[] = []
    for (const id of deletedIdArr) {
      const deleted = await this.updateDeletedWithLogOperateId({ deletedId: id, logOperateId: payload.logOperateId })
      if (deleted) {
        res.push(deleted)
      }
    }
    return res
  }

  private getRepository() {
    return this.dataSource.manager.getRepository(SysDeletedEntity)
  }
}

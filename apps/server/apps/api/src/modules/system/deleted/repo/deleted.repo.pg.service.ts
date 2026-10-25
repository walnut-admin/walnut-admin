import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { DataSource } from 'typeorm'
import { SysDeletedEntity } from '../entity/deleted.entity'

export interface ISysDeletedPgCreatePayload {
  /** 被删文档快照（jsonb 直存对象，原 stringify text 已升级，phase2 5.3） */
  content: Record<string, unknown>
  /** 恢复路由键，取 `WalnutDBModelName` 模型名 */
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
 * PostgreSQL 版回收站仓库（对应 Mongo 版 `SysDeletedRepoService`，两者并存）。
 *
 * 只服务 PG 软删路径（`pg-base.repository.ts` 的 deleteSoftById）；Mongo 版本批不动，
 * 回收站读取 / 恢复的 Mongo 逻辑收编在 B9。`em` 传自 `WalnutTxContext.em` 时，
 * 快照写入与原行删除同事务；缺省走连接级 manager（非事务路径）。
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
}

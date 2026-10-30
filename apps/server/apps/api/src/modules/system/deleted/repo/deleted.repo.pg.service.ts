/* eslint-disable no-restricted-syntax -- 回收站快照的系统写腿：createSoftDelete 由基类 deleteSoftById 调用（此时已按 scope 读过被删行），快照本身的 deletedBy 就是删除者；再套 scope 会把系统写入路径自身挡住（循环依赖）。 */
import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutAdminConstAppConfig } from '@walnut-server/const/app/config'
import { runInWalnutSystemTransaction, WalnutPGConnectionName, withWalnutSystemManager } from '@walnut-server/db'
import { WalnutAdminExceptionInternalServerError } from '@walnut-server/exceptions/base.exception'

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
    // 数据权限三期：sys_deleted 缺省 anonymous —— 无 em（系统写腿）时走 system 事务
    return withWalnutSystemManager(this.dataSource, em, async (manager) => {
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
    })
  }

  // bind the log operate id for the deleted document（uuid 直等更新 —— Mongo 版的
  // `new Types.ObjectId` 包装随双轨退役；未命中返回 null，与 Mongo 版一致）
  //
  // P2-29（2026-10-29）：更新条件补 `log_operate_id IS NULL` —— 同一行被软删多次
  // （恢复后再删）会在 sys_deleted 留下多份历史快照，按 deletedId 无条件更新会把
  // 旧快照的日志关联改写成最新一条。只回填「还没关联过」的快照。
  async updateDeletedWithLogOperateId(payload: { logOperateId: string, deletedId: string }) {
    // 数据权限三期：sys_deleted 缺省 anonymous —— 事件旁路写必须显式 system 事务。
    // P2-6 + P3-9 合并：这条回填是「一条删除日志 ↔ 一份快照」的一对一关联，
    // 恰好命中 1 行才是正确形态；0 行（快照不存在/已被关联）或多行（条件写坏）
    // 都是数据一致性问题，直接抛 500，不再静默吞掉。
    return runInWalnutSystemTransaction(this.dataSource, async (manager) => {
      const repository = manager.getRepository(SysDeletedEntity)

      const res = await repository.createQueryBuilder()
        .update(SysDeletedEntity)
        .set({ logOperateId: payload.logOperateId })
        .where('deleted_id = :deletedId', { deletedId: payload.deletedId })
        .andWhere('log_operate_id IS NULL')
        .execute()

      const affected = res.affected ?? 0
      if (affected !== 1) {
        throw new WalnutAdminExceptionInternalServerError({
          _devMsg: `updateDeletedWithLogOperateId expected affected=1, got ${affected} (deletedId=${payload.deletedId})`,
        })
      }

      return repository.findOne({
        where: { deletedId: payload.deletedId, logOperateId: payload.logOperateId },
      })
    })
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
}

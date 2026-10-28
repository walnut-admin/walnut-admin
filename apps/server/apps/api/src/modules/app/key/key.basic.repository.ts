import type { DataSource, EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import { AppKeyEntity } from './entity/key.entity'

/**
 * B4 迁移（repo 层，key 模块原先无 repo、service 直持 model —— 随迁移补齐，模板同
 * error/basic.repository）。基类用 PG 版 `WalnutAdminCommonPgBaseRepository`，特有
 * 查询（取当前 ACTIVE key / 按类型判存在）用 QueryBuilder 落在本子类。
 *
 * 查询执行路径（对照 phase2 4.23 索引清单）：
 * - getCurrentActiveKey：`WHERE type=$1 AND status='ACTIVE' ORDER BY version DESC LIMIT 1`
 *   —— idx_app_key_status (status) 收敛 ACTIVE 行（key 表是个位数到数十行的配置级小表，
 *   文档索引清单刻意只有 PK / uq_key / idx_app_key_status，type 维度无索引即蓝图口径）；
 * - existsByType：`WHERE type=$1 LIMIT 1` —— 同上，小表顺序扫描即正确路径。
 */
@Injectable()
export class AppKeyBasicRepository extends WalnutAdminCommonPgBaseRepository<AppKeyEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(AppKeyEntity, WalnutModelName.APP_KEY, dataSource)
  }

  /**
   * @description get current active app key by type（version 最大者，对齐 Mongo 版
   * findOne({type,status:ACTIVE}).sort({version:-1})）
   *
   * P1-1 修复（2026-10-28）：`lock` 为 true 时在事务内 `FOR UPDATE` 锁住当前 ACTIVE 行 ——
   * rotate 的「读当前 → 置 DEPRECATED → 插新行」三腿被串行化，两路并发时败者在锁释放后
   * 重读不到 ACTIVE 行（已被置 DEPRECATED）→ 受控 40401，不再产生两条同 version ACTIVE。
   * 只读调用方（getCurrent）不传 lock，保持无锁快路径。
   */
  public async getCurrentActiveKey(type: string, em?: EntityManager, lock = false): Promise<AppKeyEntity | null> {
    // 悲观锁只在活跃事务里有意义（TypeORM 对非事务上下文直接抛
    // PessimisticLockTransactionRequiredError）；非事务调用退化为普通读，
    // 并发保护由 rotate 的调用方（HTTP @WalnutTx / cron transactional）保证
    const pessimisticLock = lock && em?.queryRunner?.isTransactionActive
      ? { mode: 'pessimistic_write' as const }
      : undefined
    return this.getManager(em)
      .getRepository(AppKeyEntity)
      .findOne({
        where: { type, status: 'ACTIVE' },
        order: { version: 'DESC' },
        ...(pessimisticLock ? { lock: pessimisticLock } : {}),
      })
  }

  /**
   * @description init first document 的存在性判断（对齐 Mongo 版 exists({type})）
   */
  public async existsByType(type: string, em?: EntityManager): Promise<boolean> {
    return this.getManager(em).getRepository(AppKeyEntity).exists({ where: { type } })
  }

  /**
   * @description 实体级保存（对齐 Mongo 版 `doc.status = ...; doc.save({ session })`）
   */
  public async save(entity: AppKeyEntity, em?: EntityManager): Promise<AppKeyEntity> {
    return this.getManager(em).getRepository(AppKeyEntity).save(entity)
  }

  /**
   * @description 程序化事务 —— rotateForCronJob 无 HTTP 请求上下文（不走
   * WalnutTxInterceptor），用 DataSource.transaction 承接原 Mongo startSession /
   * startTransaction 的手动事务；HTTP 侧 rotate 走 controller 的 `ctx.em` 透传。
   */
  public async transactional<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work)
  }
}

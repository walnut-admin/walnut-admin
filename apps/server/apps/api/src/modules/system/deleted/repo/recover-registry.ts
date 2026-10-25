import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'

/**
 * PG 回收站恢复器注册表（phase2 5.3 定案的「显式注册表」骨架）。
 *
 * Mongo 版恢复走 `db.model(modelName)` 运行时动态模型（来什么存什么）；PG 有强
 * schema，快照 jsonb → 实体的列级映射必须显式，因此恢复路由收口为
 * `modelName → IWalnutPgSnapshotRecoverer` 的注册表：每个迁 PG 的模块在装配期把
 * 自己的恢复器注册进来（B0b 只交付注册表本身，业务模块的恢复器随各自迁移批次落地，
 * Mongo 版 `deleted.service.ts` 的恢复路径本批不动）。
 *
 * 注册表是空表启动 —— `recover` 时查无恢复器即抛错，替代动态模型的「默默失败」。
 */
export interface IWalnutPgSnapshotRecoverer {
  /**
   * 把快照对象还原回原表（insert 一行）。实现约束：
   * - 快照引用列已是 uuid（v5 派生规则），无需重写；
   * - 必须接收事务内 `em`（recover 的「原表 insert + sys_deleted delete」两步写
   *   要在同一本地事务内）。
   */
  recover: (content: Record<string, unknown>, em: EntityManager) => Promise<unknown>
}

@Injectable()
export class SysDeletedPgRecoverRegistry {
  private readonly logger = new Logger(SysDeletedPgRecoverRegistry.name)

  private readonly recoverers = new Map<string, IWalnutPgSnapshotRecoverer>()

  /**
   * @description 模块装配期注册恢复器；同名重复注册是装配错误，直接抛错而非静默覆盖
   */
  register(modelName: string, recoverer: IWalnutPgSnapshotRecoverer): void {
    if (this.recoverers.has(modelName)) {
      throw new Error(`[SysDeletedPgRecoverRegistry] recoverer for "${modelName}" is already registered`)
    }
    this.recoverers.set(modelName, recoverer)
    this.logger.log(`recoverer registered: ${modelName}`)
  }

  get(modelName: string): IWalnutPgSnapshotRecoverer | undefined {
    return this.recoverers.get(modelName)
  }

  has(modelName: string): boolean {
    return this.recoverers.has(modelName)
  }
}

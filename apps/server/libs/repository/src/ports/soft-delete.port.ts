import type { EntityManager } from 'typeorm'

/**
 * 软删除策略端口（libs 解耦批 5 的依赖反转）。
 *
 * 基类仓库 `deleteSoftById` 在删除原行之前要往 `sys_deleted` 落一份快照 —— 快照实体
 * `SysDeletedEntity` 在本 lib，仓库服务（`SysDeletedPgRepoService` 的 `createSoftDelete`）
 * 在 `libs/system`（域层；repository 不能反向 import 它）。端口只描述基类用到的
 * **一个方法**与快照载荷形状；实现由 `libs/system` 的
 * `SysDeletedRepoModule`（@Global）用
 * `{ provide: WALNUT_ADMIN_SOFT_DELETE_STRATEGY, useExisting: SysDeletedPgRepoService }`
 * 绑定，`implements ISoftDeleteStrategy` 作编译期守护。
 *
 * 绑定缺失 = 启动期 DI 报错（本端口在基类里是**必需**注入，与解耦前直接注入
 * `SysDeletedPgRepoService` 的失败形态等价；不做 `@Optional`，避免把「静默不写快照」
 * 这种语义事故推迟到第一次软删）。
 */
export const WALNUT_ADMIN_SOFT_DELETE_STRATEGY = Symbol('WALNUT_ADMIN_SOFT_DELETE_STRATEGY')

/** 软删快照载荷 —— 对应 sys_deleted 的写入面（jsonb content 直存对象） */
export interface IWalnutAdminSoftDeletePayload {
  /** 被删行快照（jsonb 直存对象） */
  content: Record<string, unknown>
  /** 恢复路由键（WalnutModelName 模型名） */
  modelName: string
  /** PG 表名（纯记录字段） */
  collectionName: string
  /** 被删行 uuid */
  deletedId: string
  /** 删除者 uuid（松引用直传） */
  deletedBy: string
  /** 操作日志松引用，可空 */
  logOperateId?: string | null
}

/**
 * 返回值刻意是 unknown：实体类（SysDeletedEntity，批 7 起在本 lib 的 entities/ 下）
 * 不参与端口契约；现状唯一调用方（基类软删路径）忽略返回值。将来若需要快照行，
 * 定义结构类型而不是放开成实体。
 */
export interface ISoftDeleteStrategy {
  createSoftDelete: (payload: IWalnutAdminSoftDeletePayload, em?: EntityManager) => Promise<unknown>
}

import type { ClientSession } from 'mongoose'
import type { EntityManager } from 'typeorm'

/**
 * 事务上下文 —— `@WalnutDBTransaction()` + `@WalnutDBSession()` 的统一产物，挂在
 * `request.txContext` 上。一次请求内同时持有两个引擎的会话句柄：
 *
 * - `em`：PG 侧事务内 EntityManager（QueryRunner.manager），**已迁 PG 的**数据路径用它
 *   读写，所有写入随拦截器统一 commit / rollback；
 * - `dbSession`：Mongo 侧 ClientSession，**未迁的**数据路径继续用它（迁移完成前所有
 *   业务 repo 都走这里）。engine 元数据不含 mongo 时为 undefined。
 *
 * 两个引擎在拦截器里的提交顺序是「先 PG 后 Mongo」，见 tx.interceptor.ts。
 */
export interface WalnutTxContext {
  em: EntityManager
  dbSession?: ClientSession
}

/**
 * 事务引擎选择。默认 `both`：PG 与 Mongo 同时开启、同时提交/回滚 —— 迁移期业务模块
 * 还在 Mongo，PG 事务先行开启是为了让「同请求双写」从第一天就处于同一事务语义下；
 * 已全部迁 PG 的端点可收窄为 `pg`（省掉副本集 session 开销），纯 Mongo 保留端点可
 * 收窄为 `mongo`。装饰器侧缺省即 `both`。
 */
export const WalnutTxEngine = {
  PG: 'pg',
  MONGO: 'mongo',
  BOTH: 'both',
} as const

export type IWalnutTxEngineType = (typeof WalnutTxEngine)[keyof typeof WalnutTxEngine]

/** `@WalnutDBTransaction({ engine })` 落到 handler 上的元数据键 */
export const WalnutTxEngineMetadataKey = 'walnut:tx:engine'

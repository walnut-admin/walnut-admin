import type { EntityManager } from 'typeorm'

/**
 * 事务上下文 —— `@WalnutTx()` + `@WalnutTxSession()` 的统一产物，挂在
 * `request.txContext` 上：
 *
 * `em`：PG 事务内 EntityManager（QueryRunner.manager），所有数据路径用它读写，
 * 写入随拦截器统一 commit / rollback（Phase 5a 起 PG 是唯一引擎，Mongo 会话句柄
 * `dbSession` 已随双引擎拦截器一并摘除）。
 */
export interface WalnutTxContext {
  em: EntityManager
}

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { InjectConnection } from '@nestjs/mongoose'
import { InjectDataSource } from '@nestjs/typeorm'
import { ClientSession, Connection } from 'mongoose'
import { catchError, concatMap, Observable } from 'rxjs'

import { DataSource, QueryRunner } from 'typeorm'
import { WalnutDBConnectionName } from './db.const'
import { DBTransactionHooksStore } from './db.hook'
import { WalnutPGConnectionName } from './pg.const'
import { IWalnutTxEngineType, WalnutTxContext, WalnutTxEngine, WalnutTxEngineMetadataKey } from './tx-context'

/**
 * 双引擎事务拦截器 —— `@WalnutDBTransaction()` 的执行体。
 *
 * 一次请求同时开启 PG 事务与 Mongo 事务（迁移期所有业务 repo 仍在 Mongo，但
 * `request.txContext.em` 从第一天起就是真实的 PG 事务句柄，让「同请求双写」具备
 * 统一的事话语义）：
 *
 * - PG 走 **QueryRunner** 方式（createQueryRunner + startTransaction），不用
 *   `DataSource.transaction()` 回调式 —— 后者把事务生命周期锁在回调作用域里，无法
 *   与拦截器生命周期的 commit / release 解耦，也无法把 `em` 交出去；
 * - Mongo 走既有 startSession + startTransaction（命名连接 `WalnutDBConnectionName`，
 *   另开连接的 session 会报 "session from different cluster"）。
 *
 * 提交顺序固定「先 PG 后 Mongo」：PG 提交失败时 Mongo 随后回滚，两边都不会留下
 * 半提交状态（反向顺序下 Mongo 先提交、PG 提交失败会出现 Mongo 已落库的脏数据）。
 * after-commit 钩子（`DBTransactionHooksStore`）在两个引擎都提交后统一执行。
 *
 * engine 元数据（`@WalnutDBTransaction({ engine })`）可选 `pg | mongo | both`，
 * 缺省 `both`；engine 排除某引擎时该引擎的会话句柄不创建（`dbSession` 为 undefined）。
 * 错误传播语义与提交/回滚的守卫结构对齐 transaction.interceptor.ts。
 */
@Injectable()
export class WalnutTxInterceptor implements NestInterceptor {
  protected readonly logger = new Logger(WalnutTxInterceptor.name)

  constructor(
    @InjectConnection(WalnutDBConnectionName)
    private readonly mongoConnection: Connection,
    @InjectDataSource(WalnutPGConnectionName)
    private readonly pgDataSource: DataSource,
    private readonly reflector: Reflector,
  ) { }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const className = context.getClass().name
    const handlerName = context.getHandler().name

    const engine: IWalnutTxEngineType = this.reflector.get<undefined | IWalnutTxEngineType>(
      WalnutTxEngineMetadataKey,
      context.getHandler(),
    ) ?? WalnutTxEngine.BOTH

    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()

    // --- 双引擎会话创建：任一引擎创建失败，已创建的另一半必须释放，不能泄漏 ---
    let queryRunner = null as null | QueryRunner
    let session = null as null | ClientSession
    try {
      // PG 引擎：QueryRunner 事务（engine 含 pg 才开启）
      if (engine === 'pg' || engine === 'both') {
        queryRunner = this.pgDataSource.createQueryRunner()
        await queryRunner.connect()
        await queryRunner.startTransaction()
      }

      // Mongo 引擎：命名连接上的 session 事务（engine 含 mongo 才开启；
      // 另开连接的 session 会报 "session from different cluster"）
      if (engine === 'mongo' || engine === 'both') {
        session = await this.mongoConnection.startSession()
        session.startTransaction()
      }
    }
    catch (e) {
      if (queryRunner) {
        await queryRunner.release().catch(() => undefined)
      }
      if (session) {
        await session.endSession().catch(() => undefined)
      }
      throw e
    }

    const txContext: WalnutTxContext = {
      // em 恒有值：含 pg 时是事务内 manager；engine 收窄为 mongo 时给连接级
      // manager（非事务），此时 em 上不应有任何写入
      em: queryRunner ? queryRunner.manager : this.pgDataSource.manager,
      dbSession: session ?? undefined,
    }
    request.txContext = txContext

    const hooks: (() => Promise<void>)[] = []
    let pgCommitted = false
    let pgReleased = false
    let mongoCommitted = false
    let mongoEnded = false

    return DBTransactionHooksStore.run(hooks, () =>
      next.handle().pipe(
        concatMap(async (value: unknown) => {
          this.logger.log(`Transaction commit: ${className}.${handlerName}`)

          try {
            if (queryRunner) {
              await queryRunner.commitTransaction()
              pgCommitted = true
            }
          }
          finally {
            if (queryRunner) {
              await queryRunner.release()
              pgReleased = true
            }
          }

          try {
            if (session) {
              await session.commitTransaction()
              mongoCommitted = true
            }
          }
          finally {
            if (session) {
              await session.endSession()
              mongoEnded = true
            }
          }

          // execute post-commit hooks (sync)
          for (const hook of hooks) {
            try {
              await hook()
              this.logger.log('[POST-COMMIT] after commit')
            }
            catch (e) {
              this.logger.error(e)
            }
          }

          return value
        }),
        catchError(async (err) => {
          this.logger.log(`Transaction abort: ${className}.${handlerName}`)

          try {
            // commit 已释放的 runner/session 不能再 rollback/abort（会抛
            // QueryRunnerAlreadyReleasedError / MongoRuntimeError 掩盖原始错误），
            // 释放标志必须一并纳入守卫
            if (queryRunner && !pgCommitted && !pgReleased)
              await queryRunner.rollbackTransaction()
          }
          finally {
            if (queryRunner && !pgReleased)
              await queryRunner.release()
          }

          try {
            if (session && !mongoCommitted && !mongoEnded)
              await session.abortTransaction()
          }
          finally {
            if (session && !mongoEnded)
              await session.endSession()
          }

          throw err
        }),
      ))
  }
}

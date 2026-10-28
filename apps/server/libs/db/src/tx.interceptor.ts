import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { catchError, concatMap, Observable } from 'rxjs'

import { DataSource } from 'typeorm'
import { DBTransactionHooksStore } from './db.hook'
import { WalnutPGConnectionName } from './pg.const'
import { WalnutTxContext } from './tx-context'

/**
 * 事务拦截器 —— `@WalnutTx()` 的执行体（PG 单引擎，Phase 5a 起）。
 *
 * PG 走 **QueryRunner** 方式（createQueryRunner + startTransaction），不用
 * `DataSource.transaction()` 回调式 —— 后者把事务生命周期锁在回调作用域里，无法
 * 与拦截器生命周期的 commit / release 解耦，也无法把 `em` 交出去。
 *
 * 提交路径：commit → release → after-commit 钩子（`DBTransactionHooksStore`）统一执行；
 * 错误路径：rollback → release，原始错误透传。守卫结构（`pgCommitted/pgReleased`）保留
 * 自双引擎时代：commit 已释放的 runner 不能再 rollback（会抛
 * QueryRunnerAlreadyReleasedError 掩盖原始错误），释放标志必须一并纳入守卫。
 * （历史注记：迁移期曾在此同时开启 Mongo session、固定「先 PG 后 Mongo」提交，
 * Phase 5a 随 MongoDB 摘除收窄为单引擎。）
 */
@Injectable()
export class WalnutTxInterceptor implements NestInterceptor {
  protected readonly logger = new Logger(WalnutTxInterceptor.name)

  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly pgDataSource: DataSource,
  ) { }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const className = context.getClass().name
    const handlerName = context.getHandler().name

    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()

    // 会话创建失败（connect / startTransaction 抛错）必须释放已取得的 runner，不能泄漏连接
    const queryRunner = this.pgDataSource.createQueryRunner()
    try {
      await queryRunner.connect()
      await queryRunner.startTransaction()
    }
    catch (e) {
      await queryRunner.release().catch(() => undefined)
      throw e
    }

    const txContext: WalnutTxContext = {
      em: queryRunner.manager,
    }
    request.txContext = txContext

    const hooks: (() => Promise<void>)[] = []
    let pgCommitted = false
    let pgReleased = false

    return DBTransactionHooksStore.run(hooks, () =>
      next.handle().pipe(
        concatMap(async (value: unknown) => {
          this.logger.log(`Transaction commit: ${className}.${handlerName}`)

          try {
            await queryRunner.commitTransaction()
            pgCommitted = true
          }
          finally {
            await queryRunner.release()
            pgReleased = true
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
            if (!pgCommitted && !pgReleased)
              await queryRunner.rollbackTransaction()
          }
          finally {
            if (!pgReleased)
              await queryRunner.release()
          }

          throw err
        }),
      ))
  }
}

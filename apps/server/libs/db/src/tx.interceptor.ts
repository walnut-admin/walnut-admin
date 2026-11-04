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
import { applyWalnutDataScopeRlsSettings, WALNUT_DATA_SCOPE_RLS_MODE } from './data-scope-rls'
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
 * 错误路径：**rollback → release**，原始错误透传。守卫结构（`pgCommitted/pgReleased`）保留
 * 自双引擎时代：commit 已释放的 runner 不能再 rollback（会抛
 * QueryRunnerAlreadyReleasedError 掩盖原始错误），释放标志必须一并纳入守卫。
 *
 * 历史生产 bug（别退回）：本文件曾经「只 release 不 rollback」—— TypeORM 的 `release()` 不结束事务，
 * 连接会带着未提交事务回池、被下一个请求借走（详见 `rollbackIfActive` 的注释与单测
 * `tx.interceptor.spec.ts`）。两条失败出口（会话建立 / handler 抛错）都必须走它。
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

    const queryRunner = this.pgDataSource.createQueryRunner()

    // 生命周期守卫，两个失败出口共用：
    // - commit 已经释放过的 runner 不能再 rollback（1.1.2 的 rollbackTransaction 在
    //   `isTransactionActive === false` 时**抛** TransactionNotStartedError，不是 no-op）；
    // - release 只允许发生一次（重复 release 抛 QueryRunnerAlreadyReleasedError）。
    let pgCommitted = false
    let pgReleased = false

    /**
     * 失败路径的唯一出口，顺序不可调换：**先 rollback，再 release**。
     *
     * 为什么 rollback 不能省：TypeORM 1.1.2 的
     * `PostgresQueryRunner.releasePostgresConnection()` 只把 client 还给 pg-pool、把
     * runner 从 driver 的活跃清单里摘掉，**既不发 ROLLBACK 也不清 isTransactionActive**
     * （// LINK apps/server/node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:93-105）。
     * 于是「带着未提交事务回池」的连接会被下一个借主拿走，而 PG 把事务块内的
     * `START TRANSACTION` 只当 WARNING + no-op —— 借主看不出自己正站在别人的未提交事务里，
     * 它的语句全落进那个事务：别人看不见、自己也不提交（静默丢数据 / 丢可见性）。
     *
     * rollback 自身失败只记日志：它的错误不能顶替原始错误，也不能阻止 release。
     */
    const rollbackIfActive = async (): Promise<void> => {
      if (pgCommitted || pgReleased || !queryRunner.isTransactionActive) {
        return
      }

      await queryRunner.rollbackTransaction().catch((e: unknown) => this.logger.error(e))
    }

    const releaseOnce = async (): Promise<void> => {
      if (pgReleased) {
        return
      }

      pgReleased = true
      await queryRunner.release().catch((e: unknown) => this.logger.error(e))
    }

    // 会话创建失败（connect / startTransaction / RLS 设置抛错）同样走「回滚 → 释放」：
    // startTransaction 成功后只 release 会把活跃事务留在这条连接上（见 rollbackIfActive）。
    try {
      await queryRunner.connect()
      await queryRunner.startTransaction()

      // 数据权限三期：RLS 设置必须写在与查询同连接同事务上（set_config local = true）。
      // ALSRequestInterceptor（全局，先于本拦截器执行）已把当前请求的 RLS 设置挂到
      // request.dataScopeRls；缺失（理论不可达）按 system 兜底 —— 未设置时策略也是 system，
      // 显式写出来是为了让连接上的状态永远可预期。
      await applyWalnutDataScopeRlsSettings(
        queryRunner.manager,
        request.dataScopeRls ?? { mode: WALNUT_DATA_SCOPE_RLS_MODE.SYSTEM, userId: '', deptIds: [] },
      )
    }
    catch (e) {
      await rollbackIfActive()
      await releaseOnce()
      throw e
    }

    const txContext: WalnutTxContext = {
      em: queryRunner.manager,
    }
    request.txContext = txContext

    const hooks: (() => Promise<void>)[] = []

    return DBTransactionHooksStore.run(hooks, () =>
      next.handle().pipe(
        concatMap(async (value: unknown) => {
          this.logger.log(`Transaction commit: ${className}.${handlerName}`)

          try {
            await queryRunner.commitTransaction()
            pgCommitted = true
          }
          finally {
            await releaseOnce()
          }

          // execute post-commit hooks —— **在事务 ALS 上下文之外**执行。
          // 数据权限三期：hook 内若调用已注册实体的基类仓库（很常见：缓存失效反查、
          // 恢复后联动），基类会探测到「外层事务上下文存在但没有 em」并抛
          // DataScopeTransactionRequired（500）。此时事务已提交、runner 已释放，
          // 正确语义是 hook 走自己的自动事务/系统读腿，所以这里显式 exit。
          await DBTransactionHooksStore.exit(async () => {
            for (const hook of hooks) {
              try {
                await hook()
                this.logger.log('[POST-COMMIT] after commit')
              }
              catch (e) {
                this.logger.error(e)
              }
            }
          })

          return value
        }),
        catchError(async (err) => {
          this.logger.log(`Transaction abort: ${className}.${handlerName}`)

          await rollbackIfActive()
          await releaseOnce()

          throw err
        }),
      ))
  }
}

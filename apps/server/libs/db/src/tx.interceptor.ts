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
import { createQueryRunnerTxGuard } from './tx.runner'

/**
 * 事务拦截器 —— `@WalnutTx()` 的执行体（PG 单引擎，Phase 5a 起）。
 *
 * PG 走 **QueryRunner** 方式（createQueryRunner + startTransaction），不用
 * `DataSource.transaction()` 回调式 —— 后者把事务生命周期锁在回调作用域里，无法
 * 与拦截器生命周期的 commit / release 解耦，也无法把 `em` 交出去。
 *
 * 提交路径：commit → release → after-commit 钩子（`DBTransactionHooksStore`）统一执行；
 * 错误路径：**rollback → release**，原始错误透传。
 *
 * **本类保留自己的 runner 生命周期，是刻意的**：commit 发生在 RxJS 管道里（`concatMap`），
 * 与 `intercept()` 的同步返回不在同一作用域，借不到 `withQueryRunnerTransaction` 的
 * 回调式生命周期；但它与那一支共用**同一份守卫**（`createQueryRunnerTxGuard`，见
 * `tx.runner.ts`）—— 提交/回滚/释放的顺序与幂等只有一处定义。
 *
 * 历史生产 bug（别退回）：本文件曾经「只 release 不 rollback」—— TypeORM 的 `release()` 不结束事务，
 * 连接会带着未提交事务回池、被下一个请求借走（池污染机理与真实 PG 判据见 `tx.runner.ts` 文件头、
 * 单测 `tx.interceptor.spec.ts` 与集成用例 `tx.pool-pollution.int-spec.ts`）。两条失败出口
 * （会话建立 / handler 抛错）都必须走守卫的 `rollback`。
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

    // 生命周期守卫（commit / rollback / release 的守卫与幂等）只定义在 tx.runner.ts 一处 ——
    // 本类是它的第二个消费者，不是第二份实现：commit 已释放过的 runner 不能再 rollback
    // （1.1.2 的 rollbackTransaction 在 `isTransactionActive === false` 时**抛**
    // TransactionNotStartedError，不是 no-op），release 也只允许发生一次。
    const tx = createQueryRunnerTxGuard(queryRunner, this.logger)

    // 会话创建失败（connect / startTransaction / RLS 设置抛错）同样走「回滚 → 释放」：
    // startTransaction 成功后只 release 会把活跃事务留在这条连接上。
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
      await tx.rollback()
      await tx.release()
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
            await tx.commit()
          }
          finally {
            await tx.release()
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

          await tx.rollback()
          await tx.release()

          throw err
        }),
      ))
  }
}

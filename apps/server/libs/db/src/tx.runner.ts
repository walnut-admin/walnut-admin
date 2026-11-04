import type { DataSource, EntityManager, QueryRunner } from 'typeorm'
import { Logger } from '@nestjs/common'

/**
 * QueryRunner 事务的**唯一**生命周期实现（connect / start / commit / rollback / release）。
 *
 * 为什么要有它：这套守卫此前在拦截器、基类仓库、RLS 系统事务、登录链三处 OAuth/OTP
 * 服务里各手写一份，形状各不相同 —— 其中「startTransaction 在 try 之外」「catch 里
 * rollback 不再守 isTransactionActive」「rollback 抛错顶替原始错误」都是真实存在于其中
 * 某几份副本里的错法。守卫一旦有副本，修好一份不会自动修好另一份，所以只留一份。
 *
 * 它保证的四件事（判据在 `__tests__/tx.runner.spec.ts`）：
 * 1. `release` 恰好一次 —— 任何一个出口（connect 失败 / startTransaction 失败 / 回调
 *    抛错 / commit 抛错 / 正常提交）都且只归还一次连接，重复调用是 no-op；
 * 2. 失败路径**先 rollback 再 release** —— TypeORM 1.1.2 的
 *    `PostgresQueryRunner.releasePostgresConnection()` 只把 client 还给 pg-pool、
 *    把 runner 摘出 driver 活跃清单，**既不发 ROLLBACK 也不清 isTransactionActive**
 *    （// LINK apps/server/node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:93-105）。
 *    于是「带着未提交事务回池」的连接会被下一个借主拿走，而 PG 把事务块内的
 *    `START TRANSACTION` 只当 WARNING + no-op —— 借主看不出自己正站在别人的未提交事务里，
 *    它的语句全落进那个事务：别人看不见、自己也不提交（静默丢数据 / 丢可见性）；
 * 3. 清理动作（rollback / release）**自身抛错只记日志**，绝不顶替原始错误，也不阻止后续
 *    的 release —— 否则真正的根因会被 `TransactionNotStartedError` /
 *    `QueryRunnerAlreadyReleasedError` 盖掉；
 * 4. `commit` 失败照抛 —— 提交没成功是调用方必须知道的事实，不属于「清理噪声」。
 *
 * 真实 PG 的服务端判据（`pg_stat_activity.state` 是 idle 还是 idle in transaction）见
 * `apps/api/test/integration/tx/tx.pool-pollution.int-spec.ts`。
 */

/** 清理动作失败时的日志落点（Nest `Logger` 直接满足） */
export interface IWalnutQueryRunnerTxLogger {
  /** 只接受清理动作的错误 —— 业务错误由调用方透传，不走这里 */
  error: (message: unknown) => void
}

/**
 * 一条 QueryRunner 上的生命周期守卫。持有它就是「承诺」：无论怎么退出，连接都只还一次、
 * 且还池那一刻不带未提交事务。
 */
export interface IWalnutQueryRunnerTxGuard {
  /** commit 是否已成功（成功后 rollback 一律 no-op） */
  readonly committed: boolean
  /** release 是否已发生（幂等标记） */
  readonly released: boolean
  /** 提交；失败原样抛出（调用方必须知道没提交成功） */
  commit: () => Promise<void>
  /** 回滚；已提交 / 已释放 / 事务从未开启时 no-op，自身异常只记日志 */
  rollback: () => Promise<void>
  /** 归还连接；恰好一次，自身异常只记日志 */
  release: () => Promise<void>
}

/**
 * 建守卫（不自己借连接）。
 *
 * 单独暴露是给**必须跨 await 持有 runner** 的调用方用的（`WalnutTxInterceptor`：事务的
 * commit 发生在 RxJS 管道里，与 `intercept()` 的同步返回不在同一个作用域）—— 它们借不到
 * `withQueryRunnerTransaction` 的回调式生命周期，但仍应共用同一份守卫实现。
 */
export function createQueryRunnerTxGuard(
  queryRunner: Pick<QueryRunner, 'commitTransaction' | 'isTransactionActive' | 'release' | 'rollbackTransaction'>,
  logger?: IWalnutQueryRunnerTxLogger,
): IWalnutQueryRunnerTxGuard {
  const log = logger ?? new Logger('WalnutQueryRunnerTx')
  let committed = false
  let released = false

  return {
    get committed() {
      return committed
    },
    get released() {
      return released
    },

    async commit() {
      await queryRunner.commitTransaction()
      committed = true
    },

    // 守卫不是防御性编程的洁癖：TypeORM 1.1.2 的 rollbackTransaction 在
    // `isTransactionActive === false` 时**抛** TransactionNotStartedError，不是 no-op。
    async rollback() {
      if (committed || released || !queryRunner.isTransactionActive) {
        return
      }

      await queryRunner.rollbackTransaction().catch((e: unknown) => log.error(e))
    },

    async release() {
      if (released) {
        return
      }

      // 先置位再 await：release 自身抛错时，重试只会撞 QueryRunnerAlreadyReleasedError
      released = true
      await queryRunner.release().catch((e: unknown) => log.error(e))
    },
  }
}

export interface IWalnutQueryRunnerTxOptions {
  /**
   * 只读事务（`SET TRANSACTION READ ONLY`）。
   * PG 要求它是事务里的**第一条语句**，所以本函数把它排在 `setup` 之前 —— 顺序不可调换。
   */
  readOnly?: boolean
  /**
   * 事务开启后、回调之前的准备语句（RLS 的 `set_config(..., true)` 等）。
   * 执行在同一个 manager 上 ⇒ 与回调里的查询同连接同事务。
   */
  setup?: (manager: EntityManager) => Promise<void>
  /** 清理动作失败的日志器；请求级调用传自己的 Logger，日志里才能带上处理器名 */
  logger?: IWalnutQueryRunnerTxLogger
}

/**
 * 借一条连接、开一个事务、执行 `fn`，并按「正常 → commit + release」「抛错 → rollback +
 * release」收尾（语义与保证见文件头）。
 *
 * `connect` / `startTransaction` / `setup` 全在 try 内 —— 会话建立阶段的失败**同样**要
 * 回滚并归还连接，不能让连接带着活跃事务留在池里（登录链的自管事务曾把这三步写在 try 外，
 * 一旦 RLS 设置抛错就既不回滚也不释放）。
 */
export async function withQueryRunnerTransaction<T>(
  dataSource: Pick<DataSource, 'createQueryRunner'>,
  fn: (manager: EntityManager) => Promise<T>,
  options: IWalnutQueryRunnerTxOptions = {},
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner()
  const tx = createQueryRunnerTxGuard(queryRunner, options.logger)

  try {
    await queryRunner.connect()
    await queryRunner.startTransaction()

    if (options.readOnly === true) {
      await queryRunner.query('SET TRANSACTION READ ONLY')
    }

    await options.setup?.(queryRunner.manager)

    const result = await fn(queryRunner.manager)

    await tx.commit()

    return result
  }
  catch (e) {
    // 含 commit 自身失败：此时 committed 仍为 false、事务状态未知，补一条 ROLLBACK 是安全的
    // （服务端若已自行回滚，PG 只回 WARNING）。
    await tx.rollback()
    throw e
  }
  finally {
    await tx.release()
  }
}

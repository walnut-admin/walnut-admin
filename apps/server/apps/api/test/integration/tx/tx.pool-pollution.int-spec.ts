import type { CallHandler, ExecutionContext, INestApplication } from '@nestjs/common'
import type { WalnutTxContext } from '@walnut-server/db'
import type { DataSource, QueryRunner } from 'typeorm'
import { WALNUT_DATA_SCOPE_RLS_SYSTEM_SETTINGS, WalnutTxInterceptor, withQueryRunnerTransaction, withWalnutRlsTransaction } from '@walnut-server/db'
import { from, lastValueFrom, throwError } from 'rxjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgAdminDataSource, getWalnutPgDataSource } from '../helpers/create-integration-app'

/**
 * **连接池污染**的真实 PG 复现与回归（libs/db/src/tx.interceptor.ts 失败路径）。
 *
 * bug 形态：拦截器 `startTransaction()` 成功后，catch 里只 `release()` 不 `rollback()`。
 * TypeORM 1.1.2 的 `PostgresQueryRunner.releasePostgresConnection()` 只把 client 还给
 * pg-pool、把 runner 摘出 driver 活跃清单（PostgresQueryRunner.js:93-105）：不发 ROLLBACK、
 * 不清 `isTransactionActive`。于是「带着未提交事务回池」的连接被下一个借主拿走，而 PG 把
 * 事务块内的 `START TRANSACTION` 只当 WARNING + no-op —— 借主看不出自己在别人的未提交事务
 * 里，它的语句全落进那个事务：别人看不见、自己也不提交（seed / 业务写静默丢失）。
 * 实测症状：concurrency 集成用例的种子 INSERT 没提交 → `expected 3 to be 1003`。
 *
 * 本 spec 不靠 TypeORM 自述的 `isTransactionActive` 下结论，判据取自**服务端**：
 * `pg_stat_activity.state`（管理连接读，admin 角色对同库 backend 可见）——
 * 「修好后」必须是 `idle`，「bug 态」是 `idle in transaction`。第三条用例是同一判据的
 * **负对照**（把该 runner 的 rollback 钝化，模拟修复前的代码），它证明这条判据真能看见 bug。
 *
 * 同一条判据也套在 `libs/db` 的唯一事务帮手上（拦截器与自管事务现在共用同一份守卫）：
 * 帮手提交 → idle；帮手回调抛错 → idle 且事务号 `aborted`；帮手 setup 抛错 → idle。
 */

describe('连接池污染：WalnutTxInterceptor 失败路径「先 rollback 再 release」（真实 PG）', () => {
  let app: INestApplication
  /** 应用连接（walnut_app）：拦截器必须走它，池污染才落在应用池上 */
  let pgDataSource: DataSource
  /** 管理连接：读 pg_stat_activity 的判据通道 */
  let adminPgDataSource: DataSource

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    adminPgDataSource = getWalnutPgAdminDataSource(app)
  })

  afterAll(async () => {
    await app.close()
  })

  function makeExecutionContext(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
      getClass: () => class PoolPollutionSpecHandler { },
      getHandler: () => function poolPollutionSpecHandler() { },
    } as unknown as ExecutionContext
  }

  /**
   * 借一条**真实** runner，并在 `startTransaction` 成功后记下它的 backend pid ——
   * 后续判据全部按 pid 定点读服务端状态，不受池里其他连接的干扰。
   */
  function borrowRunner(): { runner: QueryRunner, backendPid: () => number } {
    const runner = pgDataSource.createQueryRunner()
    const originalStartTransaction = runner.startTransaction.bind(runner)
    let pid = 0

    runner.startTransaction = async () => {
      await originalStartTransaction()
      const rows = await runner.query('SELECT pg_backend_pid() AS pid') as Array<{ pid: number }>
      pid = Number(rows[0].pid)
    }

    return { runner, backendPid: () => pid }
  }

  async function backendState(pid: number): Promise<string> {
    const rows = await adminPgDataSource.query<Array<{ state: string | null }>>(
      'SELECT state FROM pg_stat_activity WHERE pid = $1',
      [pid],
    )
    return rows[0]?.state ?? 'backend-gone'
  }

  /** 固定拦截器使用的 runner（真实 runner，只是不经 createQueryRunner 随机借一条） */
  function interceptorOn(runner: QueryRunner): WalnutTxInterceptor {
    return new WalnutTxInterceptor({ createQueryRunner: () => runner } as unknown as DataSource)
  }

  /** 固定帮手使用的 runner（同 interceptorOn，帮手只用到 createQueryRunner） */
  function dataSourceOn(runner: QueryRunner): Pick<DataSource, 'createQueryRunner'> {
    return { createQueryRunner: () => runner }
  }

  /** 包一层 release 计数：帮手的保证之一是「恰好归还一次」 */
  function countReleases(runner: QueryRunner): () => number {
    const originalRelease = runner.release.bind(runner)
    let count = 0

    runner.release = async () => {
      count += 1
      await originalRelease()
    }

    return () => count
  }

  it('会话建立阶段抛错（RLS 设置 TypeError）：连接还池时不在事务里（state = idle）', async () => {
    const { runner, backendPid } = borrowRunner()
    const interceptor = interceptorOn(runner)
    // 畸形的请求 RLS 设置（deptIds 非数组）⇒ applyWalnutDataScopeRlsSettings 在
    // startTransaction 成功之后抛 TypeError —— 与「RLS 写不进事务」等价的最短触发面
    const request: Record<string, unknown> = {
      dataScopeRls: { mode: 'system', userId: '', deptIds: null },
    }

    await expect(interceptor.intercept(
      makeExecutionContext(request),
      { handle: () => throwError(() => new Error('handler 不该被执行')) },
    )).rejects.toThrow(TypeError)

    // 服务端判据：这条 backend 已回到池里，并且**不在**事务中（bug 态是 idle in transaction）
    expect(await backendState(backendPid())).toBe('idle')
    expect(runner.isTransactionActive).toBe(false)
  })

  it('handler 抛错（catchError 路径）：连接还池时同样不在事务里（state = idle）', async () => {
    const { runner, backendPid } = borrowRunner()
    const interceptor = interceptorOn(runner)
    const request: Record<string, unknown> = {}

    // handler 先用事务句柄真跑一条语句（模拟业务写），再抛错
    const next: CallHandler = {
      handle: () => from((async () => {
        const tx = (request as { txContext?: WalnutTxContext }).txContext
        await tx!.em.query('SELECT 1')
        throw new Error('handler boom')
      })()),
    }

    const result$ = await interceptor.intercept(makeExecutionContext(request), next)
    await expect(lastValueFrom(result$)).rejects.toThrow('handler boom')

    expect(await backendState(backendPid())).toBe('idle')
    expect(runner.isTransactionActive).toBe(false)
  })

  it('withWalnutRlsTransaction 提交：RLS 设置写在事务里，归还连接时 state = idle', async () => {
    const { runner, backendPid } = borrowRunner()
    const releases = countReleases(runner)
    let mode = ''

    await withWalnutRlsTransaction(
      dataSourceOn(runner),
      WALNUT_DATA_SCOPE_RLS_SYSTEM_SETTINGS,
      async (manager) => {
        const rows = await manager.query<Array<{ mode: string | null }>>(
          'SELECT current_setting($1, true) AS mode',
          ['app.data_scope.mode'],
        )
        mode = rows[0]?.mode ?? ''
      },
    )

    // 设置确实落在**这个事务**里（local = true），不是会话级残留
    expect(mode).toBe('system')
    expect(await backendState(backendPid())).toBe('idle')
    expect(runner.isTransactionActive).toBe(false)
    expect(releases()).toBe(1)
  })

  it('withWalnutRlsTransaction 回调抛错：回滚 + 归还，事务号是 aborted、连接 state = idle', async () => {
    const { runner, backendPid } = borrowRunner()
    const releases = countReleases(runner)
    let xid = ''

    await expect(withWalnutRlsTransaction(
      dataSourceOn(runner),
      WALNUT_DATA_SCOPE_RLS_SYSTEM_SETTINGS,
      async (manager) => {
        const rows = await manager.query<Array<{ xid: string }>>('SELECT txid_current() AS xid')
        xid = String(rows[0].xid)
        throw new Error('helper boom')
      },
    )).rejects.toThrow('helper boom')

    // 零残留判据（服务端）：这个事务号在 PG 里的终态必须是 aborted，不是 committed
    const status = await adminPgDataSource.query<Array<{ status: string }>>(
      'SELECT txid_status($1::bigint) AS status',
      [xid],
    )
    expect(status[0]?.status).toBe('aborted')
    expect(await backendState(backendPid())).toBe('idle')
    expect(runner.isTransactionActive).toBe(false)
    expect(releases()).toBe(1)
  })

  it('withQueryRunnerTransaction 的 setup 抛错（事务已开启）：回滚 + 归还，state = idle', async () => {
    const { runner, backendPid } = borrowRunner()
    const releases = countReleases(runner)

    await expect(withQueryRunnerTransaction(
      dataSourceOn(runner),
      async () => 'never',
      {
        setup: async () => {
          throw new Error('setup boom')
        },
      },
    )).rejects.toThrow('setup boom')

    // 旧写法把 connect / startTransaction / 设置写在 try 之外：这里会读到 idle in transaction
    expect(await backendState(backendPid())).toBe('idle')
    expect(runner.isTransactionActive).toBe(false)
    expect(releases()).toBe(1)
  })

  // 顺序是判据的一部分：本用例把一条连接弄成 idle in transaction 后 `pg_terminate_backend`
  // 掐断它，pg-pool 要等 socket error 才会丢弃该 client —— 下一轮 borrowing 可能先摸到
  // 这条已死的 client（表现是 `terminating connection due to administrator command`）。
  // 所以负对照**放在最后**，不要往后追加用例。
  it('负对照：把该 runner 的 rollback 钝化（= 修复前的「只 release」）⇒ 同一条判据读到 idle in transaction', async () => {
    const { runner, backendPid } = borrowRunner()
    // 只 release 不 rollback —— 正是修复前 catch 分支的错法
    runner.rollbackTransaction = async () => undefined
    const interceptor = interceptorOn(runner)
    const request: Record<string, unknown> = {
      dataScopeRls: { mode: 'system', userId: '', deptIds: null },
    }

    await expect(interceptor.intercept(
      makeExecutionContext(request),
      { handle: () => throwError(() => new Error('handler 不该被执行')) },
    )).rejects.toThrow(TypeError)

    // 判据灵敏度自检：同一条连接、同一条查询 —— 这里必须是「带着未提交事务回池」
    expect(await backendState(backendPid())).toBe('idle in transaction')

    // 清场：这条连接已被污染，掐断它（pg-pool 收到 error 会丢弃该 client，不再借给后续用例）
    await adminPgDataSource.query('SELECT pg_terminate_backend($1)', [backendPid()])
  })
})

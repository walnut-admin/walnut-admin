import type { CallHandler, ExecutionContext, INestApplication } from '@nestjs/common'
import type { WalnutTxContext } from '@walnut-server/db'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { AppDemoEntity } from '@walnut-server/app-domain'
import { registerAfterCommitHook, WalnutTxInterceptor } from '@walnut-server/db'

import { from, lastValueFrom, throwError } from 'rxjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgAdminDataSource, getWalnutPgDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * PG 单引擎事务语义（libs/db/src/tx.interceptor.ts）：直接实例化真实拦截器
 * （真实 PG DataSource + Reflector），用假 ExecutionContext 驱动 —— 验证的是
 * interceptor 本体，不是它的等价复刻：
 *
 * - 同一 `WalnutTxContext.em`（事务内 manager）上的写随拦截器统一 commit 落库；
 * - handler 抛错 → PG rollback，零残留；
 * - after-commit 钩子在 commit 后执行，且能看到已提交数据；
 * - next observable 同步 error 同样触发回滚；
 * - commit 自身抛错：原始错误透传、已释放的 runner 不再 rollback（守卫）。
 *
 * （历史注记：B0~B9 本 spec 是双引擎语义基准 —— 同一 ctx 下 PG 写 + Mongo scratch
 * 模型写双 commit、engine 元数据收窄、PG 失败连带 Mongo abort；Phase 5a 摘除 MongoDB
 * 后收窄为单引擎，scratch 模型与 engine 元数据随双引擎拦截器一并退役。）
 */
describe('WalnutTxInterceptor single-engine transaction semantics (on real PG)', () => {
  let app: INestApplication
  /** 应用连接（walnut_app）：拦截器与事务句柄必须走它，RLS 才会真实生效 */
  let pgDataSource: DataSource
  /** 管理连接：事务外对账（应用连接池级无 GUC，fail-closed 下看不到行） */
  let adminPgDataSource: DataSource

  function pgInsertPayload(demoString: string, demoPhoneNumber: string) {
    // NOT NULL 无 DB 默认的数组列必须显式给值（phase2 4.20，含 demo_uuid_array）
    return {
      demoString,
      demoPhoneNumber,
      demoStringArray: [],
      demoNumberArray: [],
      demoBooleanArray: [],
      demoDateArray: [],
      demoEnumArray: [],
      demoMongoIdArray: [],
    }
  }

  function makeExecutionContext(request: unknown, handler: () => void): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
      getClass: () => class PgTxSpecHandler { },
      getHandler: () => handler,
    } as unknown as ExecutionContext
  }

  async function drive(
    interceptor: WalnutTxInterceptor,
    request: unknown,
    handler: (tx: WalnutTxContext) => Promise<unknown>,
  ): Promise<unknown> {
    const next: CallHandler = { handle: () => from(handler((request as { txContext: WalnutTxContext }).txContext)) }
    // intercept 是 async（内含 queryRunner.connect / startTransaction），Nest 侧会先 await
    // 再订阅；这里同样先 await 拿到 observable 才能等到终态
    const result$ = await interceptor.intercept(makeExecutionContext(request, () => undefined), next)
    return lastValueFrom(result$) as Promise<unknown>
  }

  beforeAll(async () => {
    // AppDemoEntity 已随 demo.module 迁 PG 注册（B1 起），这里直接用全量 AppModule
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    adminPgDataSource = getWalnutPgAdminDataSource(app)

    // 守卫自检：指向集成库
    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)
  })

  afterAll(async () => {
    await app.close()
  })

  function buildInterceptor() {
    return new WalnutTxInterceptor(pgDataSource)
  }

  async function countPg(demoString: string) {
    // 管理通道读（应用连接池级无事务设置 → fail-closed 0 行）
    return adminPgDataSource.manager.count(AppDemoEntity, { where: { demoString } })
  }

  function uniqueString() {
    return `int-pg-txn-${randomUUID()}`
  }

  it('commit：同一 WalnutTxContext.em（事务内 manager）上的写随拦截器统一落库', async () => {
    const interceptor = buildInterceptor()
    const demoString = uniqueString()
    const request = {}
    let ctxAtHandlerTime: WalnutTxContext | undefined

    await drive(interceptor, request, async (tx) => {
      ctxAtHandlerTime = tx
      // em 必须是事务内 manager，不是连接级 manager（否则写入就不在拦截器的事务里）
      expect(tx.em).not.toBe(pgDataSource.manager)
      await tx.em.insert(AppDemoEntity, pgInsertPayload(demoString, `137${randomUUID().replaceAll('-', '')}`))
    })

    expect(ctxAtHandlerTime!.em).toBeDefined()
    expect(await countPg(demoString)).toBe(1)
  })

  it('回滚：handler 抛错 → PG rollback，零残留', async () => {
    const interceptor = buildInterceptor()
    const demoString = uniqueString()
    const request = {}

    await expect(drive(interceptor, request, async (tx) => {
      await tx.em.insert(AppDemoEntity, pgInsertPayload(demoString, `137${randomUUID().replaceAll('-', '')}`))
      throw new Error('rollback on purpose')
    })).rejects.toThrow('rollback on purpose')

    expect(await countPg(demoString)).toBe(0)
  })

  it('after-commit 钩子：commit 后执行，且钩子里能看到已提交数据', async () => {
    const interceptor = buildInterceptor()
    const demoString = uniqueString()
    const request = {}
    let hookRan = false
    let pgCountAtHookTime = -1

    await drive(interceptor, request, async (tx) => {
      await tx.em.insert(AppDemoEntity, pgInsertPayload(demoString, `137${randomUUID().replaceAll('-', '')}`))

      registerAfterCommitHook(async () => {
        hookRan = true
        pgCountAtHookTime = await countPg(demoString)
      })

      // handler 结束时钩子只是入队
      expect(hookRan).toBe(false)
    })

    expect(hookRan).toBe(true)
    expect(pgCountAtHookTime).toBe(1)
  })

  it('handler 同步异常（next observable 直接 error）同样触发回滚', async () => {
    const interceptor = buildInterceptor()
    const request = {}

    const next: CallHandler = { handle: () => throwError(() => new Error('sync failure on purpose')) }

    const result$ = await interceptor.intercept(makeExecutionContext(request, () => undefined), next)
    await expect(lastValueFrom(result$) as Promise<unknown>)
      .rejects
      .toThrow('sync failure on purpose')
  })

  it('commit 自身抛错：原始错误透传、已释放的 runner 不再 rollback（守卫）', async () => {
    const runnerCalls: string[] = []
    // 假 PG runner：connect/start 正常、commit 即抛 —— 复现「commit 失败」路径
    const fakeRunner = {
      connect: async () => undefined,
      startTransaction: async () => undefined,
      commitTransaction: async () => {
        throw new Error('pg commit boom')
      },
      rollbackTransaction: async () => {
        runnerCalls.push('rollback')
      },
      release: async () => {
        runnerCalls.push('release')
      },
      manager: pgDataSource.manager,
    }
    const fakePgDataSource = { createQueryRunner: () => fakeRunner } as unknown as DataSource

    const interceptor = new WalnutTxInterceptor(fakePgDataSource)

    await expect(drive(interceptor, {}, async () => undefined)).rejects.toThrow('pg commit boom')

    // runner 已 release：不得再对它 rollback（AlreadyReleased 错会掩盖原始错误）
    expect(runnerCalls).toEqual(['release'])
  })

  it('事务内写入对事务外连接不可见（读已提交隔离下的存在性对账）', async () => {
    const interceptor = buildInterceptor()
    const demoString = uniqueString()
    const request = {}
    let visibleOutsideDuringTx = -1

    await drive(interceptor, request, async (tx) => {
      await tx.em.insert(AppDemoEntity, pgInsertPayload(demoString, `137${randomUUID().replaceAll('-', '')}`))
      // 事务提交前，事务外的连接级 manager 看不到这行写
      visibleOutsideDuringTx = await countPg(demoString)
    })

    expect(visibleOutsideDuringTx).toBe(0)
    expect(await countPg(demoString)).toBe(1)
  })
})

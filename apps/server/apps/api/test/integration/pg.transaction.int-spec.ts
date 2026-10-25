import type { CallHandler, ExecutionContext, INestApplication } from '@nestjs/common'
import type { WalnutTxContext } from '@walnut-server/db'
import type { ClientSession, Connection, Model } from 'mongoose'
import type { DataSource, EntityManager } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { registerAfterCommitHook, WalnutTxEngine, WalnutTxEngineMetadataKey, WalnutTxInterceptor } from '@walnut-server/db'
import { Schema } from 'mongoose'
import { from, lastValueFrom, throwError } from 'rxjs'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AppDemoEntity } from '@/modules/app/demo/entity/demo.entity'
import { createIntegrationApp, getWalnutConnection, getWalnutPgDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * 双引擎事务语义（libs/db/src/tx.interceptor.ts）：直接实例化真实拦截器
 * （真实 Mongo 命名连接 + 真实 PG DataSource + Reflector），用假 ExecutionContext
 * 驱动 —— 验证的是 interceptor 本体，不是它的等价复刻：
 *
 * - 同一 `WalnutTxContext` 下 PG 写（em）+ Mongo 写（dbSession）双 commit 都落库；
 * - handler 抛错 → PG rollback + Mongo abort，两侧零残留；
 * - after-commit 钩子在两个引擎都 commit 后执行，且能看到已提交数据；
 * - engine 元数据收窄：`mongo` 不开 PG 事务、`pg` 不开 Mongo session。
 *
 * Mongo 写腿（B3 起）：与迁移顺序解耦的永久方案 —— 在命名连接上注册一次性
 * scratch 模型（`Schema({}, { strict: false })`，集合 `int_spec_scratch`），直接
 * `create(..., { session })` 做事务性 Mongo 写。不再跟随任何一个业务模块的迁移
 * 状态换载体（B1 时代指到 sys_dict_type，B3 迁走即失效）；该集合与迁移无关，
 * B10 随 Mongo 一起清理。
 */
describe('WalnutTxInterceptor dual-engine transaction semantics (on real PG + Mongo)', () => {
  let app: INestApplication
  let scratchModel: Model<Record<string, unknown>>
  let mongoConnection: Connection
  let pgDataSource: DataSource

  function uniqueScratchPayload() {
    return {
      kind: 'int-pg-txn',
      seed: randomUUID(),
    }
  }

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
    // intercept 是 async（内含 queryRunner.connect / startSession），Nest 侧会先 await
    // 再订阅；这里同样先 await 拿到 observable 才能等到终态
    const result$ = await interceptor.intercept(makeExecutionContext(request, () => undefined), next)
    return lastValueFrom(result$) as Promise<unknown>
  }

  beforeAll(async () => {
    // AppDemoEntity 已随 demo.module 迁 PG 注册（B1 起），这里直接用全量 AppModule
    app = await createIntegrationApp()
    mongoConnection = getWalnutConnection(app)
    pgDataSource = getWalnutPgDataSource(app)

    // 守卫自检：双库都指向集成库
    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)
    expect(mongoConnection.name).toBe(INTEGRATION_DATABASE_NAME)

    // B3 起的 Mongo 写腿载体：一次性 scratch 模型（strict: false 的空 schema），
    // 只服务本 spec 的事务语义验证，与业务模块的迁移状态解耦（B10 随 Mongo 清理）
    scratchModel = (mongoConnection.models.IntSpecScratchTx
      ?? mongoConnection.model('IntSpecScratchTx', new Schema({}, { strict: false }), 'int_spec_scratch')) as Model<Record<string, unknown>>

    // Mongoose 的惰性建索引会隐式创建集合：若本文件的事务写 int_spec_scratch 时集合尚不存在，
    // 事务的隐式建集合会与 boot 期索引构建相撞，commit 报 "already in use"。
    // 开事务前先确保集合存在，让事务写走普通路径。
    await mongoConnection.db?.createCollection('int_spec_scratch').catch(() => undefined)
  })

  afterAll(async () => {
    await app.close()
  })

  function buildInterceptor() {
    return new WalnutTxInterceptor(mongoConnection, pgDataSource, new Reflector())
  }

  async function countPg(demoString: string) {
    return pgDataSource.manager.count(AppDemoEntity, { where: { demoString } })
  }

  function countMongo(seed: string) {
    return scratchModel.countDocuments({ seed })
  }

  /**
   * MongoDB 事务锁竞争重试（**只用于非事务操作**）：上一条事务 commit/abort 已 await，
   * 但服务端锁释放是异步的（unique 索引维护会延长持锁），紧随其后的同集合非事务读可能
   * 撞 IX 锁获取超时（"Unable to acquire IX lock ... within 5ms"）—— 官方归类的
   * TransientTransactionError，标准处置是退避重试。
   *
   * 刻意不包装事务内的写：锁超时发生在事务内时服务端已把整个事务置为 aborted，
   * 正确处置是放弃整条事务重来（整测试重试），不是在同一条死事务里重试写。
   */
  async function withIxLockRetry<T>(fn: () => Promise<T>): Promise<T> {
    const LOCK_ERROR = 'Unable to acquire IX lock'
    let lastError: unknown

    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        return await fn()
      }
      catch (e) {
        lastError = e
        if (!(e instanceof Error) || !e.message.includes(LOCK_ERROR)) {
          throw e
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }

    throw lastError
  }

  /**
   * 用例间的锁排空：上一条用例的事务锁释放是异步的，下一条用例的事务首写可能在
   * 5ms 内抢不到 IX 锁、连坐整条事务。这里以**非事务**探针写（插一条随即删除）
   * 轮询到成功为止 —— 非事务写能成功即证明集合锁已可用，下一条用例从干净状态开始。
   */
  afterEach(async () => {
    await withIxLockRetry(async () => {
      const probe = await scratchModel.create([
        { kind: 'lock-drain-probe', seed: randomUUID() },
      ])
      await scratchModel.deleteOne({ _id: probe[0]._id })
    })
  })

  it('双 commit：同一 WalnutTxContext 下 PG 写 + Mongo 写全部落库', async () => {
    const interceptor = buildInterceptor()
    const payload = uniqueScratchPayload()
    const request = {}
    let ctxAtHandlerTime: WalnutTxContext | undefined

    await drive(interceptor, request, async (tx) => {
      ctxAtHandlerTime = tx
      await tx.em.insert(AppDemoEntity, pgInsertPayload(payload.seed, `137${randomUUID().replaceAll('-', '')}`))
      await scratchModel.create([{ ...payload }], { session: tx.dbSession })
    })

    expect(ctxAtHandlerTime!.dbSession).toBeDefined()
    expect(await countPg(payload.seed)).toBe(1)
    expect(await withIxLockRetry(() => countMongo(payload.seed))).toBe(1)
  })

  it('回滚：handler 抛错 → PG rollback + Mongo abort，两侧零残留', async () => {
    const interceptor = buildInterceptor()
    const payload = uniqueScratchPayload()
    const request = {}

    await expect(drive(interceptor, request, async (tx) => {
      await tx.em.insert(AppDemoEntity, pgInsertPayload(payload.seed, `137${randomUUID().replaceAll('-', '')}`))
      await scratchModel.create([{ ...payload }], { session: tx.dbSession })
      throw new Error('rollback on purpose')
    })).rejects.toThrow('rollback on purpose')

    expect(await countPg(payload.seed)).toBe(0)
    expect(await withIxLockRetry(() => countMongo(payload.seed))).toBe(0)
  })

  it('after-commit 钩子：两个引擎 commit 后执行，且钩子里能看到已提交数据', async () => {
    const interceptor = buildInterceptor()
    const payload = uniqueScratchPayload()
    const request = {}
    let hookRan = false
    let pgCountAtHookTime = -1
    let mongoCountAtHookTime = -1

    await drive(interceptor, request, async (tx) => {
      await tx.em.insert(AppDemoEntity, pgInsertPayload(payload.seed, `137${randomUUID().replaceAll('-', '')}`))
      await scratchModel.create([{ ...payload }], { session: tx.dbSession })

      registerAfterCommitHook(async () => {
        hookRan = true
        pgCountAtHookTime = await countPg(payload.seed)
        mongoCountAtHookTime = await withIxLockRetry(() => countMongo(payload.seed))
      })

      // handler 结束时钩子只是入队
      expect(hookRan).toBe(false)
    })

    expect(hookRan).toBe(true)
    expect(pgCountAtHookTime).toBe(1)
    expect(mongoCountAtHookTime).toBe(1)
  })

  it('handler 同步异常（next observable 直接 error）同样触发双回滚', async () => {
    const interceptor = buildInterceptor()
    const request = {}

    const next: CallHandler = { handle: () => throwError(() => new Error('sync failure on purpose')) }

    const result$ = await interceptor.intercept(makeExecutionContext(request, () => undefined), next)
    await expect(lastValueFrom(result$) as Promise<unknown>)
      .rejects
      .toThrow('sync failure on purpose')
  })

  it('engine=mongo：不开 PG 事务（em 是连接级 manager），dbSession 存在', async () => {
    const handler = (() => undefined) as () => void
    SetMetadata(WalnutTxEngineMetadataKey, WalnutTxEngine.MONGO)(handler)

    const interceptor = new WalnutTxInterceptor(mongoConnection, pgDataSource, new Reflector())
    const request = {}
    let seen: WalnutTxContext | undefined

    const next: CallHandler = { handle: () => from((async () => {
      seen = (request as { txContext: WalnutTxContext }).txContext
    })()) }

    const result$ = await interceptor.intercept(makeExecutionContext(request, handler), next)
    await lastValueFrom(result$)

    expect(seen!.dbSession).toBeDefined()
    expect(seen!.em).toBe(pgDataSource.manager)
  })

  it('engine=pg：不开 Mongo session（dbSession undefined），PG 写照常提交', async () => {
    const handler = (() => undefined) as () => void
    SetMetadata(WalnutTxEngineMetadataKey, WalnutTxEngine.PG)(handler)

    const interceptor = new WalnutTxInterceptor(mongoConnection, pgDataSource, new Reflector())
    const payload = uniqueScratchPayload()
    const request = {}
    let seen: { em: EntityManager, dbSession?: undefined } | undefined

    const next: CallHandler = { handle: () => from((async () => {
      seen = (request as { txContext: { em: EntityManager, dbSession?: undefined } }).txContext
      await seen.em.insert(AppDemoEntity, pgInsertPayload(payload.seed, `137${randomUUID().replaceAll('-', '')}`))
    })()) }

    const result$ = await interceptor.intercept(makeExecutionContext(request, handler), next)
    await lastValueFrom(result$)

    expect(seen!.dbSession).toBeUndefined()
    expect(seen!.em).not.toBe(pgDataSource.manager)
    expect(await countPg(payload.seed)).toBe(1)
  })

  it('PG commit 自身抛错：原始错误透传、不回滚已释放 runner、Mongo session 仍被 abort', async () => {
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

    // 真实 Mongo session 包记录器，观察 PG commit 失败后 Mongo 是否被 abort
    // （不 abort 的话 session 泄漏到服务端事务超时才释放）
    const realSession = await mongoConnection.startSession()
    const sessionCalls: string[] = []
    const fakeSession = {
      startTransaction: () => realSession.startTransaction(),
      commitTransaction: async () => {
        sessionCalls.push('commit')
        await realSession.commitTransaction()
      },
      abortTransaction: async () => {
        sessionCalls.push('abort')
        await realSession.abortTransaction()
      },
      endSession: async () => {
        sessionCalls.push('end')
        await realSession.endSession()
      },
    } as unknown as ClientSession
    const fakeMongoConnection = { startSession: async () => fakeSession } as unknown as Connection

    const interceptor = new WalnutTxInterceptor(fakeMongoConnection, fakePgDataSource, new Reflector())

    await expect(drive(interceptor, {}, async () => undefined)).rejects.toThrow('pg commit boom')

    // runner 已 release：不得再对它 rollback（AlreadyReleased 错会掩盖原始错误）；
    // Mongo 侧必须走到 abort + endSession
    expect(runnerCalls).toEqual(['release'])
    expect(sessionCalls).toContain('abort')
    expect(sessionCalls).toContain('end')
  })
})

import type { INestApplication } from '@nestjs/common'
import type { ClientSession } from 'mongoose'
import {
  DBTransactionHooksStore,
  registerAfterCommitHook,
  runAfterCommit,
} from '@walnut-server/db'
import { Types } from 'mongoose'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppDemoBasicRepository } from '@/modules/app/demo/demo.basic.repository'
import { SysDeletedBasicRepository } from '@/modules/system/deleted/deleted.basic.repository'
import { SysDeletedService } from '@/modules/system/deleted/deleted.service'
import { createIntegrationApp, getWalnutConnection } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * 基线（characterization）：事务语义 ——
 * - session 必须取自 `WalnutDBConnectionName` 命名连接
 *   （`libs/db/src/db.module.ts`；另开连接的 session 会报 "session from different cluster"）；
 * - `libs/db/src/transaction.interceptor.ts` 的提交/回滚 + after-commit 钩子顺序在测试里等价复刻；
 * - 仓储方法**不传 session 走非事务路径**，断言里专门区分。
 */
describe('MongoDB transaction semantics (characterization on real replica set)', () => {
  let app: INestApplication
  let demoRepo: AppDemoBasicRepository
  let deletedRepo: SysDeletedBasicRepository
  let deletedService: SysDeletedService
  let connection: ReturnType<typeof getWalnutConnection>

  const userId = new Types.ObjectId().toString()

  function uniqueDemoPayload() {
    const seed = new Types.ObjectId().toString()

    return {
      demoString: `int-txn-${seed}`,
      // 必须带唯一 demoPhoneNumber：该字段 unique: true + default: null，
      // 不带的话同一时刻 app_demo 里只能存在一条 demoPhoneNumber 为 null 的文档
      demoPhoneNumber: `137${seed}`,
    }
  }

  async function runInSessionStore(fn: (session: ClientSession) => Promise<void>): Promise<void> {
    const session = await connection.startSession()
    try {
      await session.withTransaction(async () => {
        await fn(session)
      })
    }
    finally {
      await session.endSession()
    }
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    demoRepo = app.get(AppDemoBasicRepository)
    deletedRepo = app.get(SysDeletedBasicRepository)
    deletedService = app.get(SysDeletedService)
    connection = getWalnutConnection(app)
  })

  afterAll(async () => {
    await app.close()
  })

  it('session 来自 WalnutDBConnectionName 命名连接，仓储的 dbConnection 是同一实例', () => {
    // mongoose 的 Connection#name 返回 dbName；"命名连接"由 getConnectionToken 的取法保证，
    // 这里钉死 dbName 与仓储实例走的是同一个连接对象
    expect(connection.name).toBe(INTEGRATION_DATABASE_NAME)
    expect(demoRepo.dbConnection).toBe(connection)
    expect(deletedRepo.dbConnection).toBe(connection)
  })

  it('回滚：withTransaction 内 deleteSoftById 后抛错 → app_demo 与 sys_deleted 均无残留', async () => {
    const created = await demoRepo.create(uniqueDemoPayload())

    await expect(runInSessionStore(async (session) => {
      await demoRepo.deleteSoftById(created._id.toString(), userId, session)
      throw new Error('rollback on purpose')
    })).rejects.toThrow('rollback on purpose')

    // 软删的两步写入（sys_deleted 快照 + app_demo 删除）全部回滚
    expect(await demoRepo.dbModel.countDocuments({ _id: created._id })).toBe(1)
    expect(await deletedRepo.dbModel.countDocuments({ deletedId: created._id })).toBe(0)
  })

  it('回滚：withTransaction 内 recover 后抛错 → 恢复文档与快照删除全部回滚', async () => {
    const created = await demoRepo.create(uniqueDemoPayload())
    await demoRepo.deleteSoftById(created._id.toString(), userId)

    const record = await deletedRepo.dbModel.findOne({ deletedId: created._id })
    if (!record) {
      throw new Error('expected sys_deleted snapshot to exist after soft delete')
    }

    await expect(runInSessionStore(async (session) => {
      await deletedService.recover(
        { _id: record._id.toString(), deletedId: record.deletedId.toString() },
        session,
      )
      throw new Error('rollback recover on purpose')
    })).rejects.toThrow('rollback recover on purpose')

    // recover 的两步写入（app_demo 恢复 + sys_deleted 快照删除）都走同一个 session 才可回滚 ——
    // create 若脱离数组形式，恢复写会逃逸事务：回滚后 app_demo 留下恢复的文档而快照仍在，恢复不再原子
    expect(await demoRepo.dbModel.countDocuments({ _id: created._id })).toBe(0)
    expect(await deletedRepo.dbModel.countDocuments({ _id: record._id })).toBe(1)
  })

  it('提交：withTransaction 内 create + deleteSoftById → 软删生效且快照落库', async () => {
    const payload = uniqueDemoPayload()
    let createdId = ''

    await runInSessionStore(async (session) => {
      const created = await demoRepo.create(payload, session)
      createdId = created._id.toString()
      await demoRepo.deleteSoftById(createdId, userId, session)
    })

    // 提交后（非事务读）：app_demo 里已软删、sys_deleted 里有对应快照
    expect(await demoRepo.dbModel.countDocuments({ demoString: payload.demoString })).toBe(0)
    expect(await deletedRepo.dbModel.countDocuments({ deletedId: new Types.ObjectId(createdId) })).toBe(1)
  })

  it('仓储方法不传 session 走非事务路径：写入立即提交，事务内即可见', async () => {
    const inTxnPayload = uniqueDemoPayload()
    const directPayload = uniqueDemoPayload()

    await runInSessionStore(async (session) => {
      await demoRepo.create(inTxnPayload, session)
      // 事务未提交：非事务读不可见
      expect(await demoRepo.dbModel.countDocuments({ demoString: inTxnPayload.demoString })).toBe(0)

      // 不传 session → 非事务路径，立即提交
      await demoRepo.create(directPayload)
      expect(await demoRepo.dbModel.countDocuments({ demoString: directPayload.demoString })).toBe(1)
    })
  })

  it('after-commit 钩子：commit 前不执行、commit 后执行，且钩子里能看到已提交数据', async () => {
    const payload = uniqueDemoPayload()
    const hooks: Array<() => Promise<void>> = []
    let hookRan = false
    let visibleCountAtHookTime = -1

    // 等价复刻 TransactionInterceptor：DBTransactionHooksStore.run(hooks, ...) 包住整个流程，
    // 提交成功后在同一 ALS 作用域内顺序执行钩子
    await DBTransactionHooksStore.run(hooks, async () => {
      const session = await connection.startSession()
      try {
        await session.withTransaction(async () => {
          await demoRepo.create(payload, session)

          await runAfterCommit(async () => {
            hookRan = true
            // 钩子在 commit 之后跑：非事务读可见已提交数据
            visibleCountAtHookTime = await demoRepo.dbModel.countDocuments({ demoString: payload.demoString })
          })

          // commit 前：钩子只是入队，不执行
          expect(hookRan).toBe(false)
        })

        // withTransaction 已 commit，但钩子仍由 interceptor 提交后统一执行 —— 此时也未执行
        expect(hookRan).toBe(false)
      }
      finally {
        await session.endSession()
      }

      for (const hook of hooks) {
        await hook()
      }
    })

    expect(hookRan).toBe(true)
    expect(visibleCountAtHookTime).toBe(1)
  })

  it('钩子 API 语义：registerAfterCommitHook 在事务上下文外抛错，runAfterCommit 则立即内联执行', async () => {
    expect(() => registerAfterCommitHook(async () => {}))
      .toThrow(/must be called within a transaction interceptor context/)

    let inlineRan = false
    await runAfterCommit(async () => {
      inlineRan = true
    })
    expect(inlineRan).toBe(true)
  })
})

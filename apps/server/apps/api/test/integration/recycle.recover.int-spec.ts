import type { INestApplication } from '@nestjs/common'
import type { ClientSession } from 'mongoose'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { Types } from 'mongoose'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AppDemoBasicRepository } from '@/modules/app/demo/demo.basic.repository'
import { SysDeletedBasicRepository } from '@/modules/system/deleted/deleted.basic.repository'
import { SysDeletedService } from '@/modules/system/deleted/deleted.service'
import { createIntegrationApp, getWalnutConnection } from './helpers/create-integration-app'

/**
 * 基线：回收站恢复端到端 —— `SysDeletedService.recover`（manage）与 `recoverMine`（本人）
 * 两条路径走 service 里同一个 `restoreSnapshotContent` 转换，存库形态一致。
 * 服务层的 dbSession 在真实请求里由 TransactionInterceptor 塞进 request，这里直接从
 * 命名连接开 session 传入。
 *
 * 固化的行为（迁移对比重点）：
 * 1. 恢复写入走 mongoose 9 的 `Model.create([doc], { session })` **数组**形式 —— 带 session
 *    必须传数组（单文档签名 `create(doc, options)` 不收 options：第二参被当待建文档、
 *    session 被静默丢弃并触发 mongoose WARNING，恢复写会逃逸事务）。数组形式下恢复是
 *    原子的（回滚语义见 transaction.int-spec.ts），原集合**不会**多出 demoString: null
 *    的垃圾文档 —— 各用例的垃圾文档计数断言同时是「改回单文档签名」的回归守卫。
 * 2. demo schema 的 `demoMongoId` 路径在运行时是 **Mixed**（`@Prop({ type: Types.ObjectId })`
 *    落地后不 cast，写入什么存什么）：快照里的 hex 字符串由 restoreSnapshotContent 显式
 *    转回 ObjectId，两条恢复路径恢复出的文档都与被删时形态一致。
 */
describe('SysDeletedService recover (characterization on real MongoDB)', () => {
  let app: INestApplication
  let demoRepo: AppDemoBasicRepository
  let deletedRepo: SysDeletedBasicRepository
  let deletedService: SysDeletedService
  let connection: ReturnType<typeof getWalnutConnection>

  function uniqueDemoPayload() {
    const seed = new Types.ObjectId().toString()

    return {
      demoString: `int-recover-${seed}`,
      // 用完整 seed：slice(0, 8) 取的是 ObjectId 的时间戳段，同一秒内会撞 demoPhoneNumber 唯一索引
      demoPhoneNumber: `139${seed}`,
      demoMongoId: new Types.ObjectId(),
    }
  }

  async function countGarbageDocs(): Promise<number> {
    // demoString: null 是逃逸事务写入的垃圾签名（strict mode 把误当文档的 options 剥成只剩默认值）
    return demoRepo.dbModel.countDocuments({ demoString: null })
  }

  async function runInSession(fn: (session: ClientSession) => Promise<unknown>): Promise<void> {
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

  async function createSoftDeletedDemo(deletedBy = new Types.ObjectId()) {
    const created = await demoRepo.create(uniqueDemoPayload())
    await demoRepo.deleteSoftById(created._id.toString(), deletedBy.toString())

    const record = await deletedRepo.dbModel.findOne({ deletedId: created._id })
    if (!record) {
      throw new Error('expected sys_deleted snapshot to exist after soft delete')
    }

    return { created, record }
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    demoRepo = app.get(AppDemoBasicRepository)
    deletedRepo = app.get(SysDeletedBasicRepository)
    deletedService = app.get(SysDeletedService)
    connection = getWalnutConnection(app)
  })

  // 清理历史遗留的垃圾文档（demoString: null），保证用例互相独立
  afterEach(async () => {
    await demoRepo.dbModel.deleteMany({ demoString: null })
  })

  afterAll(async () => {
    await app.close()
  })

  it('recover：文档回原集合，ObjectId 字段真的是 ObjectId，快照被移除，不产生额外文档', async () => {
    const { created, record } = await createSoftDeletedDemo()
    const garbageBefore = await countGarbageDocs()

    await runInSession(async session =>
      deletedService.recover(
        { _id: record._id.toString(), deletedId: record.deletedId.toString() },
        session,
      ))

    const restored = await demoRepo.dbModel.findById(created._id)
    if (!restored) {
      throw new Error('expected recovered document in app_demo')
    }

    // restoreSnapshotContent 把快照里的 hex 字符串转回 `Types.ObjectId`
    expect(restored._id).toBeInstanceOf(Types.ObjectId)
    expect(restored._id.toString()).toBe(created._id.toString())
    expect(restored.demoMongoId).toBeInstanceOf(Types.ObjectId)
    expect(restored.demoMongoId.toString()).toBe(created.demoMongoId.toString())
    // 快照里 JSON 序列化成的 ISO 字符串，create 时被 schema cast 回 Date
    expect(restored.createdAt).toBeInstanceOf(Date)
    expect(restored.demoString).toBe(created.demoString)

    // sys_deleted 里的快照被删掉
    expect(await deletedRepo.dbModel.countDocuments({ _id: record._id })).toBe(0)

    // create 走数组形式、session 生效：恢复写入不逃逸事务，原集合不产生 demoString: null 的垃圾文档
    expect(await countGarbageDocs()).toBe(garbageBefore)
  })

  it('recover：deletedId 不匹配 → BadRequest，快照保留、原集合不出现文档', async () => {
    const { created, record } = await createSoftDeletedDemo()
    const garbageBefore = await countGarbageDocs()

    await runInSession(async (session) => {
      await expect(deletedService.recover(
        { _id: record._id.toString(), deletedId: new Types.ObjectId().toString() },
        session,
      )).rejects.toThrow(WalnutAdminExceptionBadRequest)
    })

    expect(await demoRepo.dbModel.countDocuments({ _id: created._id })).toBe(0)
    expect(await deletedRepo.dbModel.countDocuments({ _id: record._id })).toBe(1)
    // 在 create 之前就失败了，不产生垃圾文档
    expect(await countGarbageDocs()).toBe(garbageBefore)
  })

  it('recoverMine：与 recover 同一转换，demoMongoId 恢复为 ObjectId（两条路径存库形态一致）', async () => {
    // recoverMine 与 recover 走同一个 restoreSnapshotContent：快照里的 hex 字符串转回
    // ObjectId 后入库（Mixed 路径不 cast，写入什么存什么）；`_id`（mongoose 特殊处理）
    // 与 createdAt/updatedAt（timestamps）由 schema cast 回 ObjectId / Date。
    const owner = new Types.ObjectId()
    const { created, record } = await createSoftDeletedDemo(owner)
    const garbageBefore = await countGarbageDocs()

    await runInSession(async session =>
      deletedService.recoverMine(
        { _id: record._id.toString(), deletedId: record.deletedId.toString() },
        owner.toString(),
        session,
      ))

    const restored = await demoRepo.dbModel.findById(created._id)
    if (!restored) {
      throw new Error('expected recovered document in app_demo')
    }

    expect(restored._id).toBeInstanceOf(Types.ObjectId)
    expect(restored._id.toString()).toBe(created._id.toString())
    // 与 recover 一致：demoMongoId 恢复为 ObjectId，不再是快照里的 hex 字符串
    expect(restored.demoMongoId).toBeInstanceOf(Types.ObjectId)
    expect(restored.demoMongoId.toString()).toBe(created.demoMongoId.toString())
    expect(restored.createdAt).toBeInstanceOf(Date)
    expect(restored.demoString).toBe(created.demoString)

    expect(await deletedRepo.dbModel.countDocuments({ _id: record._id })).toBe(0)

    // 同 recover：恢复写入不逃逸事务，不产生垃圾文档
    expect(await countGarbageDocs()).toBe(garbageBefore)
  })

  it('recoverMine：deletedBy 不是本人 → BadRequest', async () => {
    const { record } = await createSoftDeletedDemo(new Types.ObjectId())
    const garbageBefore = await countGarbageDocs()

    await runInSession(async (session) => {
      await expect(deletedService.recoverMine(
        { _id: record._id.toString(), deletedId: record.deletedId.toString() },
        new Types.ObjectId().toString(),
        session,
      )).rejects.toThrow(WalnutAdminExceptionBadRequest)
    })

    // 在 create 之前就失败了，不产生垃圾文档
    expect(await countGarbageDocs()).toBe(garbageBefore)
  })
})

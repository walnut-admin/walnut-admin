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
 * 基线（characterization）：回收站恢复端到端 —— `SysDeletedService.recover`（manage）
 * 与 `recoverMine`（本人）的差异现状。服务层的 dbSession 在真实请求里由
 * TransactionInterceptor 塞进 request，这里直接从命名连接开 session 传入。
 *
 * 已固化的现状怪癖（迁移对比重点）：
 * 1. Service 里恢复用的是 mongoose 9 的 `Model.create(doc, { session })` **非数组**形式 ——
 *    mongoose 会把第二参 options 当作**第二个待创建文档**（被 strict mode 剥成只剩默认值的
 *    空文档，demoString: null），且 session 被静默丢弃（mongoose 发 WARNING）→ 恢复写入实际
 *    **逃逸事务**，并在 app_demo 里多出一条 demoString: null 的垃圾文档（见各用例的 +1 断言）。
 *    仓储 base 的 create 是数组形式（session 生效），事务语义见 transaction.int-spec.ts。
 * 2. demo schema 的 `demoMongoId` 路径在运行时是 **Mixed**（`@Prop({ type: Types.ObjectId })`
 *    经 SchemaFactory 落地后 instance 为 Mixed），不做任何 cast：写入什么就存什么。
 *    于是 recover（显式 `new Types.ObjectId` 转换）恢复出 ObjectId，recoverMine（裸 JSON 字符串）
 *    恢复出**字符串** —— 两条恢复路径存库形态**并不一致**，这是 PG 侧 join 对比的关键差异。
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
    // create(doc, { session }) 的第二参被当作文档后，strict mode 剥出 demoString: null 的垃圾文档
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

  // 清理上一条用例恢复路径遗留的垃圾文档（demoString: null），保证用例互相独立
  afterEach(async () => {
    await demoRepo.dbModel.deleteMany({ demoString: null })
  })

  afterAll(async () => {
    await app.close()
  })

  it('recover：文档回原集合，ObjectId 字段真的是 ObjectId，快照被移除', async () => {
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

    // recover 显式把 isObjectIdOrHexString 的顶层值转回 `new Types.ObjectId`
    expect(restored._id).toBeInstanceOf(Types.ObjectId)
    expect(restored._id.toString()).toBe(created._id.toString())
    expect(restored.demoMongoId).toBeInstanceOf(Types.ObjectId)
    expect(restored.demoMongoId.toString()).toBe(created.demoMongoId.toString())
    // 快照里 JSON 序列化成的 ISO 字符串，create 时被 schema cast 回 Date
    expect(restored.createdAt).toBeInstanceOf(Date)
    expect(restored.demoString).toBe(created.demoString)

    // sys_deleted 里的快照被删掉
    expect(await deletedRepo.dbModel.countDocuments({ _id: record._id })).toBe(0)

    // characterization：create(doc, { session }) 的 session 被丢弃 + 第二参被当成第二个文档
    // → 恢复写入逃逸事务，app_demo 里多出一条 demoString: null 的垃圾文档
    expect(await countGarbageDocs()).toBe(garbageBefore + 1)
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

  it('recoverMine：不做显式 ObjectId 转换，demoMongoId 以字符串存取（characterization：与 recover 的存库形态不一致）', async () => {
    // 与 recover 对照：recoverMine 直接 create(JSON.parse(content))，
    // 没有 recover 里的 isObjectIdOrHexString → new Types.ObjectId 转换。
    // demo schema 的 demoMongoId 路径运行时是 Mixed（不 cast），字符串原样入库；
    // `_id`（mongoose 特殊处理）与 createdAt/updatedAt（timestamps）仍会 cast 回
    // ObjectId / Date。迁移 PG 时两条恢复路径的存库形态差异以此为准。
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
    // Mixed 路径不 cast：快照里的 hex 字符串原样存取
    expect(restored.demoMongoId).toBe(created.demoMongoId.toString())
    expect(typeof restored.demoMongoId).toBe('string')
    expect(restored.createdAt).toBeInstanceOf(Date)
    expect(restored.demoString).toBe(created.demoString)

    expect(await deletedRepo.dbModel.countDocuments({ _id: record._id })).toBe(0)

    // 同 recover：session 丢弃 + 垃圾文档 +1
    expect(await countGarbageDocs()).toBe(garbageBefore + 1)
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

import type { INestApplication } from '@nestjs/common'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { Types } from 'mongoose'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppDemoBasicRepository } from '@/modules/app/demo/demo.basic.repository'
import { SysDeletedBasicRepository } from '@/modules/system/deleted/deleted.basic.repository'
import { createIntegrationApp } from './helpers/create-integration-app'

/**
 * 基线（characterization）：`WalnutAdminCommonBasicRepository`（apps/api/src/common/repository/base.repository.ts）
 * 的 CRUD 与软删现状行为 —— 固化 MongoDB 语义，作为 PG 迁移的对比基准。
 * 断言的是现状，哪怕现状看起来怪。
 */
describe('WalnutAdminCommonBasicRepository (characterization on real MongoDB)', () => {
  let app: INestApplication
  let demoRepo: AppDemoBasicRepository
  let deletedRepo: SysDeletedBasicRepository

  const userId = new Types.ObjectId().toString()

  function uniqueDemoPayload() {
    const seed = new Types.ObjectId().toString()

    return {
      demoString: `int-base-${seed}`,
      // 用完整 seed：slice(0, 8) 取的是 ObjectId 的时间戳段，同一秒内会撞 demoPhoneNumber 唯一索引
      demoPhoneNumber: `138${seed}`,
      demoNumber: 3.1415,
      demoBoolean: true,
      demoMongoId: new Types.ObjectId(),
    }
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    demoRepo = app.get(AppDemoBasicRepository)
    deletedRepo = app.get(SysDeletedBasicRepository)
  })

  afterAll(async () => {
    await app.close()
  })

  it('create → readById：timestamps 落库、_id 是 ObjectId', async () => {
    const payload = uniqueDemoPayload()

    const created = await demoRepo.create(payload)

    expect(created._id).toBeInstanceOf(Types.ObjectId)
    expect(created.demoString).toBe(payload.demoString)
    expect(created.createdAt).toBeInstanceOf(Date)
    expect(created.updatedAt).toBeInstanceOf(Date)

    const read = await demoRepo.readById(created._id.toString())
    expect(read._id.toString()).toBe(created._id.toString())
    expect(read.demoNumber).toBe(payload.demoNumber)
  })

  it('update：字段修改并持久化', async () => {
    const created = await demoRepo.create(uniqueDemoPayload())

    const updated = await demoRepo.update(created._id.toString(), { demoNumber: 2.7183 })
    expect(updated.demoNumber).toBe(2.7183)

    const read = await demoRepo.readById(created._id.toString())
    expect(read.demoNumber).toBe(2.7183)
  })

  it('readById 不存在的 id → 抛 DataNotFound(404)', async () => {
    await expect(demoRepo.readById(new Types.ObjectId().toString()))
      .rejects
      .toThrow(WalnutAdminExceptionDataNotFound)
  })

  it('deleteSoftById：sys_deleted 快照 + 原集合文档消失', async () => {
    const payload = uniqueDemoPayload()
    const created = await demoRepo.create(payload)

    const returned = await demoRepo.deleteSoftById(created._id.toString(), userId)
    // 返回值是删除前的那份文档
    expect(returned._id.toString()).toBe(created._id.toString())
    expect(returned.demoString).toBe(payload.demoString)

    // 原集合：文档消失
    expect(await demoRepo.dbModel.countDocuments({ _id: created._id })).toBe(0)

    // sys_deleted：一条快照
    const snapshot = await deletedRepo.dbModel.findOne({ deletedId: created._id })
    if (!snapshot) {
      throw new Error('expected sys_deleted snapshot to exist')
    }

    expect(snapshot.modelName).toBe('AppDemoModel')
    expect(snapshot.collectionName).toBe('app_demo')
    expect(snapshot.deletedId).toBeInstanceOf(Types.ObjectId)
    expect(snapshot.deletedId.toString()).toBe(created._id.toString())
    expect(snapshot.deletedBy).toBeInstanceOf(Types.ObjectId)
    expect(snapshot.deletedBy.toString()).toBe(userId)
    // schema timestamps: { createdAt: 'deletedAt', updatedAt: false }
    expect(snapshot.deletedAt).toBeInstanceOf(Date)

    // content 是 JSON.stringify 的整文档：ObjectId / Date 都序列化成了字符串
    expect(typeof snapshot.content).toBe('string')
    const parsed = JSON.parse(snapshot.content) as Record<string, unknown>
    expect(parsed._id).toBe(created._id.toString())
    expect(parsed.demoString).toBe(payload.demoString)
    expect(parsed.demoMongoId).toBe(payload.demoMongoId.toString())
    expect(parsed.createdAt).toBe(created.createdAt?.toISOString())
    expect(typeof parsed.createdAt).toBe('string')

    // 本文件内的快照收尾：为防有人移除 globalSetup 的全局 drop（届时快照会跨用例残留、
    // 干扰 countDocuments 口径），用例自己清掉自己产生的这条
    await deletedRepo.dbModel.deleteOne({ _id: snapshot._id })
  })

  it('deleteRealById：真删且不产生快照', async () => {
    const created = await demoRepo.create(uniqueDemoPayload())
    const snapshotsBefore = await deletedRepo.dbModel.countDocuments({})

    const returned = await demoRepo.deleteRealById(created._id.toString())

    expect(returned._id.toString()).toBe(created._id.toString())
    expect(await demoRepo.dbModel.countDocuments({ _id: created._id })).toBe(0)
    expect(await deletedRepo.dbModel.countDocuments({})).toBe(snapshotsBefore)
  })

  it('deleteSoftById 不存在的 id → 抛 DataNotFound(404)，不产生快照', async () => {
    const snapshotsBefore = await deletedRepo.dbModel.countDocuments({})

    await expect(demoRepo.deleteSoftById(new Types.ObjectId().toString(), userId))
      .rejects
      .toThrow(WalnutAdminExceptionDataNotFound)

    expect(await deletedRepo.dbModel.countDocuments({})).toBe(snapshotsBefore)
  })
})

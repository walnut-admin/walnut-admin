import type { INestApplication } from '@nestjs/common'
import { Types } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppDemoBasicRepository } from '@/modules/app/demo/demo.basic.repository'
import { SysDeletedBasicRepository } from '@/modules/system/deleted/deleted.basic.repository'
import { SysDeletedService } from '@/modules/system/deleted/deleted.service'
import { SysUserBasicRepository } from '@/modules/system/user/user.basic.repository'
import { createIntegrationApp } from './helpers/create-integration-app'

/**
 * 基线（characterization）：populate / virtual 的输出形状 ——
 * `SysDeletedService.read()` 的 `.populate({ path: 'populated_user', select: 'userName' })`。
 * 这是将来 PG 侧用 join 复刻时的对比基准：字段名、嵌套形状、引用缺失时的形状都以现状为准。
 */
describe('virtual populate shape (characterization on real MongoDB)', () => {
  let app: INestApplication
  let demoRepo: AppDemoBasicRepository
  let deletedRepo: SysDeletedBasicRepository
  let deletedService: SysDeletedService
  let userRepo: SysUserBasicRepository

  function uniqueDemoPayload() {
    const seed = new Types.ObjectId().toString()

    return {
      demoString: `int-pop-${seed}`,
      // 唯一 demoPhoneNumber：同 transaction.int-spec.ts，避免 demoPhoneNumber null 撞唯一索引
      demoPhoneNumber: `136${seed}`,
    }
  }

  async function createSoftDeletedDemo(deletedBy: Types.ObjectId) {
    const created = await demoRepo.create(uniqueDemoPayload())
    await demoRepo.deleteSoftById(created._id.toString(), deletedBy.toString())

    const record = await deletedRepo.dbModel.findOne({ deletedId: created._id })
    if (!record) {
      throw new Error('expected sys_deleted snapshot to exist after soft delete')
    }

    return record
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    demoRepo = app.get(AppDemoBasicRepository)
    deletedRepo = app.get(SysDeletedBasicRepository)
    deletedService = app.get(SysDeletedService)
    userRepo = app.get(SysUserBasicRepository)
  })

  afterAll(async () => {
    await app.close()
  })

  it('read()：populated_user 是单个对象，select userName → 除 _id 外只有 userName', async () => {
    const user = await userRepo.create({
      userName: `int-pop-${new Types.ObjectId().toString()}`,
      nickName: 'int-populate',
    })

    const record = await createSoftDeletedDemo(user._id as Types.ObjectId)

    const doc = await deletedService.read(record._id.toString())

    // hydrate 文档上：populated_user 是被 populate 出来的 SysUser 文档
    const populated = doc.populated_user
    if (!populated) {
      throw new Error('expected populated_user to be populated')
    }
    expect(populated._id.toString()).toBe(user._id.toString())
    expect(populated.userName).toBe(user.userName)

    // SysDeleted schema toObject: { virtuals: true } → 虚拟字段出现在 toObject() 输出里
    const plain = doc.toObject()
    expect(Array.isArray(plain.populated_user)).toBe(false)

    const plainUser = plain.populated_user as unknown as Record<string, unknown>
    // characterization：populate 的 select 'userName' 只限制**查询投影**，
    // 不限制序列化形状 —— toObject() 会给未选中路径补上 schema 默认值，
    // 并带上 `id` 虚拟字段（toObject virtuals: true）。将来 PG 侧 join 的
    // 输出形状不会自然长这样，迁移对比时以此为准。
    // 注意：新增 user schema 字段请同步此列表（它就是 SysUserModel 路径全集 + id）。
    expect(Object.keys(plainUser).sort()).toEqual([
      '_id',
      'age',
      'avatar',
      'createdAt',
      'description',
      'gender',
      'id',
      'mfaSetup',
      'nickName',
      'roleMode',
      'roles',
      'status',
      'updatedAt',
      'userName',
    ])
    expect(plainUser.userName).toBe(user.userName)
  })

  it('read()：引用的 user 不存在 → populated_user 为 null（不是 undefined、不是数组）', async () => {
    // deletedBy 指向一个不存在的 user —— populate 结果为 null
    const record = await createSoftDeletedDemo(new Types.ObjectId())

    const doc = await deletedService.read(record._id.toString())

    expect(doc.populated_user).toBeNull()

    const plain = doc.toObject()
    expect(plain.populated_user).toBeNull()
  })

  it('read()：未 populate 的字段不会凭空出现（对照）', async () => {
    const record = await createSoftDeletedDemo(new Types.ObjectId())
    const doc = await deletedService.read(record._id.toString())

    // 其他虚拟字段（logOperateId 关联的 populated_log_operate 等）不在 read() 的 populate 链上
    const plain = doc.toObject()
    expect(plain.populated_log_operate).toBeUndefined()
  })
})

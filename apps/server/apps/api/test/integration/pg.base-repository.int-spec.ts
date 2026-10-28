import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import { AppDemoEntity } from '@/modules/app/demo/entity/demo.entity'
import { SysDeletedEntity } from '@/modules/system/deleted/entity/deleted.entity'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * PG 版公共基类仓库（apps/api/src/common/repository/pg-base.repository.ts）：
 * 用 B0a 实体直接实例化基类（测试内联子类，业务模块尚未切 PG），验证 ——
 * - CRUD 全链路（create 回带 DB 默认 uuid / readById / update）；
 * - deleteSoftById 写 sys_deleted（content jsonb 直存对象 + deletedAt 显式赋值）；
 * - list 走 PG 版列表构建器（分页 / ILIKE 模糊 / total / 排序 / 通配符字面量）。
 */
@Injectable()
class AppDemoPgRepository extends WalnutAdminCommonPgBaseRepository<AppDemoEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName) dataSource: DataSource,
  ) {
    super(AppDemoEntity, WalnutModelName.APP_DEMO, dataSource)
  }
}

describe('WalnutAdminCommonPgBaseRepository (on real PG)', () => {
  let app: INestApplication
  let repo: AppDemoPgRepository
  let pgDataSource: DataSource

  const userId = randomUUID()

  function uniqueDemoPayload(demoString?: string) {
    const seed = randomUUID()

    return {
      demoString: demoString ?? `int-pg-base-${seed}`,
      // PG 侧 demo_phone_number 同样 UNIQUE，必须给唯一值
      demoPhoneNumber: `138${seed.replaceAll('-', '')}`,
      // NOT NULL 数组列必须显式给值（phase2 4.20：应用侧必须显式给值）；
      // 给真实值而非 []—— TypeORM 的 save 持久化路径会把空数组当作「未赋值」丢掉，
      // 落成 NULL 撞 NOT NULL（em.insert 路径无此问题）
      demoStringArray: [`v-${seed}`],
      demoNumberArray: [1, 2],
      demoBooleanArray: [true],
      demoDateArray: [new Date('2026-01-01T00:00:00Z')],
      demoEnumArray: [1, 2],
      demoMongoIdArray: [seed],
    }
  }

  beforeAll(async () => {
    // AppModule 已注册 SysDeletedEntity（deleted.repo.module 的 forFeature），
    // 这里只补 AppDemoEntity + 内联的 PG 版仓库子类
    app = await createIntegrationApp(
      [TypeOrmModule.forFeature([AppDemoEntity], WalnutPGConnectionName)],
      [AppDemoPgRepository],
    )
    repo = app.get(AppDemoPgRepository)
    pgDataSource = getWalnutPgDataSource(app)

    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)
  })

  afterAll(async () => {
    await app.close()
  })

  it('create → readById：PK 由 DB 默认值生成（uuid），timestamps 落库', async () => {
    const payload = uniqueDemoPayload()

    const created = await repo.create(payload)

    // PK 未传 → DB 默认 gen_random_uuid() 生成，save 后回带
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(created.demoString).toBe(payload.demoString)
    expect(created.createdAt).toBeInstanceOf(Date)
    expect(created.updatedAt).toBeInstanceOf(Date)

    const read = await repo.readById(created.id)
    expect(read.id).toBe(created.id)
  })

  it('readById 不存在的 uuid → 抛 DataNotFound(404)', async () => {
    await expect(repo.readById(randomUUID()))
      .rejects
      .toThrow(WalnutAdminExceptionDataNotFound)
  })

  it('update：字段修改并持久化', async () => {
    const created = await repo.create(uniqueDemoPayload())

    // demo_number 是 integer（phase2 定稿；Mongo 侧 number 可存浮点的保真损耗属已批准设计）
    const updated = await repo.update(created.id, { demoNumber: 42 })
    expect(updated.demoNumber).toBe(42)

    const read = await repo.readById(created.id)
    expect(read.demoNumber).toBe(42)
  })

  it('deleteSoftById：原行消失 + sys_deleted 快照（jsonb 对象 / deletedAt / 模型名）', async () => {
    const payload = uniqueDemoPayload()
    const created = await repo.create(payload)

    const returned = await repo.deleteSoftById(created.id, userId)

    expect(returned.id).toBe(created.id)
    // 原集合：行消失
    expect(await pgDataSource.manager.count(AppDemoEntity, { where: { id: created.id } })).toBe(0)

    // sys_deleted：一条快照（SysDeletedEntity 已由 deleted.repo.module 注册）
    const snapshot = await pgDataSource.manager.findOne(SysDeletedEntity, { where: { deletedId: created.id } })
    expect(snapshot).not.toBeNull()
    expect(snapshot!.modelName).toBe(WalnutModelName.APP_DEMO)
    expect(snapshot!.collectionName).toBe('app_demo')
    expect(snapshot!.deletedId).toBe(created.id)
    expect(snapshot!.deletedBy).toBe(userId)
    expect(snapshot!.deletedAt).toBeInstanceOf(Date)
    // content 是 jsonb 直存对象，不再 stringify
    expect((snapshot!.content).demoString).toBe(payload.demoString)
  })

  it('deleteRealById：真删且不产生快照', async () => {
    const created = await repo.create(uniqueDemoPayload())
    const snapshotsBefore = await pgDataSource.manager.count(SysDeletedEntity)

    await repo.deleteRealById(created.id)

    expect(await pgDataSource.manager.count(AppDemoEntity, { where: { id: created.id } })).toBe(0)
    expect(await pgDataSource.manager.count(SysDeletedEntity)).toBe(snapshotsBefore)
  })

  it('list：分页、ILIKE 模糊过滤、total（COUNT(*) OVER() 单趟）、排序与通配符字面量', async () => {
    const group = randomUUID().slice(0, 8)
    const created = []
    const names = [`int-pg-list-${group}-alpha`, `int-pg-list-${group}-beta`, `int-pg-list-${group}-gamma`]
    for (const name of names) {
      created.push(await repo.create(uniqueDemoPayload(name)))
    }

    // ILIKE 模糊：命中该组全部 3 条；页大小 2 → total 3 / 第二页剩 1
    const page1 = await repo.list({
      query: { demoString: group },
      page: { page: 1, pageSize: 2 },
    } as never)
    expect(page1.total).toBe(3)
    expect(page1.data).toHaveLength(2)

    const page2 = await repo.list({
      query: { demoString: group },
      page: { page: 2, pageSize: 2 },
    } as never)
    expect(page2.total).toBe(3)
    expect(page2.data).toHaveLength(1)

    // 精确等值：uuid 直传
    const byId = await repo.list({ query: { id: created[0].id } } as never)
    expect(byId.total).toBe(1)
    expect(byId.data[0].id).toBe(created[0].id)

    // 模糊转义：ILIKE 通配符按字面量处理（PG 版收紧语义，组内无 `%alpha` 后缀）
    const literal = await repo.list({ query: { demoString: `${group}%alpha` } } as never)
    expect(literal.total).toBe(0)

    // 排序：demoNumber desc（显式 priority 缺省时按数组顺序）
    await repo.update(created[0].id, { demoNumber: 1 })
    await repo.update(created[1].id, { demoNumber: 3 })
    await repo.update(created[2].id, { demoNumber: 2 })
    const sorted = await repo.list({
      query: { demoString: group },
      sort: [{ field: 'demoNumber', order: 'descend' }],
    } as never)
    expect(sorted.data.map(i => i.demoNumber)).toEqual([3, 2, 1])
  })
})

import type { INestApplication } from '@nestjs/common'
import type { IWalnutAdminDataScopeDescriptor } from '@walnut-server/db'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm'
import { ALSRequestService } from '@walnut-server/als'
import { AppDemoEntity } from '@walnut-server/app-domain'
import { WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { WalnutAdminExceptionDataScopeContextMissing } from '@walnut-server/exceptions/business/auth'
import { SysDeletedEntity, WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgAdminDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * PG 版公共基类仓库（apps/server/libs/repository/src/pg-base.repository.ts）：
 * 用 B0a 实体直接实例化基类（测试内联子类，业务模块尚未切 PG），验证 ——
 * - CRUD 全链路（create 回带 DB 默认 uuid / readById / update）；
 * - deleteSoftById 写 sys_deleted（content jsonb 直存对象 + deletedAt 显式赋值）；
 * - list 走 PG 版列表构建器（分页 / ILIKE 模糊 / total / 排序 / 通配符字面量）；
 * - 数据权限（app_demo 已注册）：SELF / ALL / 默认拒绝的行级过滤，
 *   read/update/delete 越权 = 404，无上下文 fail-closed。
 *
 * 数据权限上下文：直接调仓库的用例必须显式进入系统通道（`als.runAsSystem`）——
 * 这正是生产侧 cron/脚本的准入形态（docs/plans/data-scope-design.md §7）。
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
  let als: ALSRequestService

  const userId = randomUUID()

  const asSystem = async <T>(fn: () => Promise<T>): Promise<T> => als.runAsSystem(fn)

  const asUser = async <T>(
    currentUserId: string,
    descriptor: IWalnutAdminDataScopeDescriptor,
    fn: () => Promise<T>,
  ): Promise<T> => als.run(async () => {
    als.set('userId', currentUserId)
    als.set('dataScope', descriptor)
    return fn()
  })

  /** 直接调仓库的用例统一走系统通道（否则已注册实体 fail-closed） */
  const itSystem = (name: string, fn: () => Promise<void>) => it(name, async () => asSystem(fn))

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

  async function createOwned(ownerId: string, demoString: string): Promise<AppDemoEntity> {
    const created = await asSystem(async () => repo.create(uniqueDemoPayload(demoString)))
    // 系统通道 create 不填 owner（没有用户）；测试直接改列造归属
    await pgDataSource.query('UPDATE app_demo SET created_by = $1 WHERE id = $2', [ownerId, created.id])
    return created
  }

  beforeAll(async () => {
    // AppModule 已注册 SysDeletedEntity（deleted.repo.module 的 forFeature），
    // 这里只补 AppDemoEntity + 内联的 PG 版仓库子类
    app = await createIntegrationApp(
      [TypeOrmModule.forFeature([AppDemoEntity], WalnutPGConnectionName)],
      [AppDemoPgRepository],
    )
    repo = app.get(AppDemoPgRepository)
    pgDataSource = getWalnutPgAdminDataSource(app)
    als = app.get(ALSRequestService)

    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)
  })

  afterAll(async () => {
    await app.close()
  })

  itSystem('create → readById：PK 由 DB 默认值生成（uuid），timestamps 落库', async () => {
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

  itSystem('readById 不存在的 uuid → 抛 DataNotFound(404)', async () => {
    await expect(repo.readById(randomUUID()))
      .rejects
      .toThrow(WalnutAdminExceptionDataNotFound)
  })

  itSystem('update：字段修改并持久化', async () => {
    const created = await repo.create(uniqueDemoPayload())

    // demo_number 是 integer（phase2 定稿；Mongo 侧 number 可存浮点的保真损耗属已批准设计）
    const updated = await repo.update(created.id, { demoNumber: 42 })
    expect(updated.demoNumber).toBe(42)

    const read = await repo.readById(created.id)
    expect(read.demoNumber).toBe(42)
  })

  itSystem('deleteSoftById：原行消失 + sys_deleted 快照（jsonb 对象 / deletedAt / 模型名）', async () => {
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

  itSystem('deleteRealById：真删且不产生快照', async () => {
    const created = await repo.create(uniqueDemoPayload())
    const snapshotsBefore = await pgDataSource.manager.count(SysDeletedEntity)

    await repo.deleteRealById(created.id)

    expect(await pgDataSource.manager.count(AppDemoEntity, { where: { id: created.id } })).toBe(0)
    expect(await pgDataSource.manager.count(SysDeletedEntity)).toBe(snapshotsBefore)
  })

  itSystem('list：分页、ILIKE 模糊过滤、total（COUNT(*) OVER() 单趟）、排序与通配符字面量', async () => {
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

  describe('数据权限（app_demo.created_by：SELF / ALL / 默认拒绝）', () => {
    const userA = randomUUID()
    const userB = randomUUID()
    const selfScope: IWalnutAdminDataScopeDescriptor = { mode: WalnutAdminConstDataScopeMode.SELF }
    const allScope: IWalnutAdminDataScopeDescriptor = { mode: WalnutAdminConstDataScopeMode.ALL }
    const denyScope: IWalnutAdminDataScopeDescriptor = { mode: WalnutAdminConstDataScopeMode.CUSTOM, deptIds: [] }

    it('SELF：list 只见本人行；read/update/updateByField/delete 越权 = 404', async () => {
      const group = randomUUID().slice(0, 8)
      const rowA = await createOwned(userA, `int-pg-scope-${group}-a`)
      const rowB = await createOwned(userB, `int-pg-scope-${group}-b`)

      const listA = await asUser(userA, selfScope, async () => repo.list({
        query: { demoString: group },
      } as never))

      expect(listA.total).toBe(1)
      expect(listA.data[0].id).toBe(rowA.id)

      await expect(asUser(userA, selfScope, async () => repo.readById(rowB.id)))
        .rejects
        .toThrow(WalnutAdminExceptionDataNotFound)

      await expect(asUser(userA, selfScope, async () => repo.update(rowB.id, { demoNumber: 7 })))
        .rejects
        .toThrow(WalnutAdminExceptionDataNotFound)

      await expect(asUser(userA, selfScope, async () => repo.updateByField({ id: rowB.id }, { demoNumber: 7 })))
        .rejects
        .toThrow(WalnutAdminExceptionDataNotFound)

      await expect(asUser(userA, selfScope, async () => repo.deleteSoftById(rowB.id, userA)))
        .rejects
        .toThrow(WalnutAdminExceptionDataNotFound)

      // 越权行未被改动/删除
      const survivor = await asSystem(async () => repo.readById(rowB.id))
      expect(survivor.demoNumber).not.toBe(7)

      // 自己的行可见可改
      const own = await asUser(userA, selfScope, async () => repo.readById(rowA.id))
      expect(own.id).toBe(rowA.id)
      const updated = await asUser(userA, selfScope, async () => repo.update(rowA.id, { demoNumber: 7 }))
      expect(updated.demoNumber).toBe(7)
    })

    it('create：显式传入 owner 列也会被当前用户覆盖（P2 纵深防御）', async () => {
      const group = randomUUID().slice(0, 8)

      const created = await asUser(userA, selfScope, async () => repo.create({
        ...uniqueDemoPayload(`int-pg-owner-${group}`),
        createdBy: userB,
      }))

      expect(created.createdBy).toBe(userA)

      const rows: Array<{ created_by: string }> = await pgDataSource.query(
        'SELECT created_by FROM app_demo WHERE id = $1',
        [created.id],
      )
      expect(rows[0].created_by).toBe(userA)
    })

    it('update / updateByField：owner 列不接受赋值（P2 纵深防御）', async () => {
      const row = await createOwned(userA, `int-pg-owner-update-${randomUUID().slice(0, 8)}`)

      const updated = await asUser(userA, selfScope, async () => repo.update(row.id, {
        createdBy: userB,
        demoNumber: 9,
      }))
      expect(updated.createdBy).toBe(userA)

      const updatedByField = await asUser(userA, selfScope, async () => repo.updateByField(
        { id: row.id },
        { createdBy: userB, demoNumber: 10 },
      ))
      expect(updatedByField.createdBy).toBe(userA)

      const rows: Array<{ created_by: string, demo_number: number }> = await pgDataSource.query(
        'SELECT created_by, demo_number FROM app_demo WHERE id = $1',
        [row.id],
      )
      expect(rows[0].created_by).toBe(userA)
      expect(rows[0].demo_number).toBe(10)
    })

    it('ALL（root）：跨用户全量可见', async () => {
      const group = randomUUID().slice(0, 8)
      await createOwned(userA, `int-pg-scope-all-${group}-a`)
      await createOwned(userB, `int-pg-scope-all-${group}-b`)

      const listAll = await asUser(userA, allScope, async () => repo.list({
        query: { demoString: group },
      } as never))

      expect(listAll.total).toBe(2)
    })

    it('默认拒绝（无角色 / 空清单）：list 0 行，readById 404', async () => {
      const row = await createOwned(userA, `int-pg-scope-deny-${randomUUID().slice(0, 8)}`)

      const list = await asUser(userA, denyScope, async () => repo.list({ query: { id: row.id } } as never))
      expect(list.total).toBe(0)

      await expect(asUser(userA, denyScope, async () => repo.readById(row.id)))
        .rejects
        .toThrow(WalnutAdminExceptionDataNotFound)
    })

    it('fail-closed：已注册实体在无 ALS 上下文时直接抛错（不默认 ALL）', async () => {
      await expect(repo.list({} as never)).rejects.toThrow(WalnutAdminExceptionDataScopeContextMissing)
      await expect(repo.create(uniqueDemoPayload())).rejects.toThrow(WalnutAdminExceptionDataScopeContextMissing)
    })
  })
})

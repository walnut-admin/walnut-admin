import type { INestApplication } from '@nestjs/common'
import type { DataSource, EntityManager } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppDemoBasicRepository } from '@/modules/app/demo/demo.basic.repository'
import { AppDemoEntity } from '@/modules/app/demo/entity/demo.entity'
import { AppErrorEntity } from '@/modules/app/error/entity/error.entity'
import { AppErrorBasicRepository } from '@/modules/app/error/error.basic.repository'
import { AppKeyEntity } from '@/modules/app/key/entity/key.entity'
import { AppKeyBasicRepository } from '@/modules/app/key/key.basic.repository'
import { SysDeletedService } from '@/modules/system/deleted/deleted.service'
import { SysDeletedEntity } from '@/modules/system/deleted/entity/deleted.entity'
import { SysUserEntity } from '@/modules/system/user/entity/user.entity'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * B9 —— 回收站全链对账基准（sys_deleted 收口 PG 单轨）：
 *
 * - 软删[PG]（经 3 个不同业务 repo 的 deleteSoftById，证明写入侧同一 sys_deleted 通道）；
 * - 列表/读取（user JOIN、content jsonb ::text 模糊、total）；
 * - recover / recoverMine（恢复注册表按 modelName 路由 —— 跨 3 个集合证明路由正确；
 *   原行回来且 uuid / created_at / updated_at 形态正确；sys_deleted 行同事务删除）；
 * - 事务语义（恢复过程抛错 → 全量回滚无残留 —— 第一步恢复成功、第二步唯一约束冲突，
 *   force-rollback 后两边都必须回到原状）；
 * - 权限语义（recoverMine 属主校验、id+deletedId 双键定位、未注册 modelName 受控错误）；
 * - 彻底删除（deleteRealMany 只清回收站，原表不回来）。
 *
 * 载体选 app_demo / app_error / app_key 三张叶子表（无 FK 牵连、唯一约束可控），
 * 服务级驱动（拦截器事务形态由 pg.transaction.int-spec 覆盖）。
 */
describe('sys_deleted recycle full chain (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let demoRepo: AppDemoBasicRepository
  let errorRepo: AppErrorBasicRepository
  let keyRepo: AppKeyBasicRepository
  let deletedService: SysDeletedService

  function uniqueDemoPayload(demoString?: string) {
    const seed = randomUUID()

    return {
      demoString: demoString ?? `int-recycle-${seed}`,
      demoPhoneNumber: `139${seed.replaceAll('-', '')}`,
      demoStringArray: [`v-${seed}`],
      demoNumberArray: [1, 2],
      demoBooleanArray: [true],
      demoDateArray: [new Date('2026-01-01T00:00:00Z')],
      demoEnumArray: [1, 2],
      demoMongoIdArray: [seed],
    }
  }

  function uniqueErrorPayload() {
    return { message: `int-recycle-error-${randomUUID()}` }
  }

  function uniqueKeyPayload() {
    return {
      key: `int-recycle-key-${randomUUID()}`,
      type: 'JWT_AT',
      version: 1,
      validStart: new Date('2026-01-01T00:00:00Z'),
    }
  }

  /** 真实 sys_user 行（deletedBy 松引用无 FK，列表 populate 靠 JOIN 命中） */
  async function insertFixtureUser() {
    const userName = `recycle-${randomUUID()}`
    await pgDataSource.manager.insert(SysUserEntity, { userName })
    return pgDataSource.manager.findOneByOrFail(SysUserEntity, { userName })
  }

  /** 唯一约束的受控冲突行：与快照同 demoString 直接插入原表（连接级 manager，已提交） */
  async function insertDemoCollision(demoString: string) {
    return demoRepo.create(uniqueDemoPayload(demoString))
  }

  beforeAll(async () => {
    // 全量 AppModule：demo/error/key 的实体与 PG 仓库、deleted 模块（含恢复注册表）齐备
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)

    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)

    demoRepo = app.get(AppDemoBasicRepository)
    errorRepo = app.get(AppErrorBasicRepository)
    keyRepo = app.get(AppKeyBasicRepository)
    deletedService = app.get(SysDeletedService)
  })

  afterAll(async () => {
    await app.close()
  })

  /**
   * 事务围栏：service 全程跑在 qr.manager 上。fn 正常返回按 commit 落库或全清；
   * fn 抛错先 rollback 再原样上抛（不等 release 的隐式回滚，语义显式）。
   */
  async function withTx(fn: (em: EntityManager) => Promise<void>, commit: boolean) {
    const queryRunner = pgDataSource.createQueryRunner()
    await queryRunner.connect()

    try {
      await queryRunner.startTransaction()

      try {
        await fn(queryRunner.manager)
      }
      catch (e) {
        await queryRunner.rollbackTransaction()
        throw e
      }

      if (commit) {
        await queryRunner.commitTransaction()
      }
      else {
        await queryRunner.rollbackTransaction()
      }
    }
    finally {
      await queryRunner.release()
    }
  }

  it('全链正路径：软删[PG] → 列表（user / content ::text / total）→ read → recover 跨 3 集合（注册表路由）', async () => {
    const user = await insertFixtureUser()

    // --- 软删（三个不同集合，写入侧同一 PG 通道）---
    const demo = await demoRepo.create(uniqueDemoPayload())
    const error = await errorRepo.create(uniqueErrorPayload())
    const key = await keyRepo.create(uniqueKeyPayload())

    // deleteSoftById 返回的是业务行快照（其 id 即 deletedId）；回收站读取/恢复的
    // 定位键是 sys_deleted 行自己的 id —— 按 deletedBy 取回后索引
    await demoRepo.deleteSoftById(demo.id, user.id)
    await errorRepo.deleteSoftById(error.id, user.id)
    await keyRepo.deleteSoftById(key.id, user.id)

    expect(await pgDataSource.manager.count(AppDemoEntity, { where: { id: demo.id } })).toBe(0)

    const snapshots = await pgDataSource.manager.find(SysDeletedEntity, { where: { deletedBy: user.id } })
    expect(new Set(snapshots.map(i => i.modelName))).toEqual(new Set(['AppDemo', 'AppError', 'AppKey']))
    for (const snapshot of snapshots) {
      expect(typeof snapshot.content).toBe('object')
      expect(snapshot.deletedAt).toBeInstanceOf(Date)
    }
    const snapshotOf = (deletedId: string) => snapshots.find(i => i.deletedId === deletedId)!

    const demoSnapshot = snapshotOf(demo.id)
    const errorSnapshot = snapshotOf(error.id)
    const keySnapshot = snapshotOf(key.id)

    // --- 列表：user JOIN + total ---
    const list = await deletedService.list({
      query: { deletedBy: user.id },
    } as never)
    expect(list.total).toBe(3)
    for (const row of list.data) {
      expect(row.user).toEqual({ id: user.id, userName: user.userName })
    }

    // content 是 jsonb：模糊搜索走 ::text cast（命中 demo 快照一条）
    const byContent = await deletedService.list({
      query: { content: (demo.demoString as string).slice(-12) },
    } as never)
    expect(byContent.total).toBe(1)
    expect(byContent.data[0]?.deletedId).toBe(demo.id)

    // --- read：user 闭环（B7a 过渡态的 hex→null 分支已随 B9 摘除）---
    const read = await deletedService.read(demoSnapshot.id)
    expect(read.id).toBe(demoSnapshot.id)
    expect(read.deletedId).toBe(demo.id)
    expect(read.content).toEqual(expect.objectContaining({ demoString: demo.demoString }))
    expect(read.user).toEqual({ id: user.id, userName: user.userName })

    // --- recover 跨 3 集合：注册表按 modelName 路由，原行回来且 uuid/时间戳形态正确 ---
    await withTx(async (em) => {
      await expect(deletedService.recover({ id: demoSnapshot.id, deletedId: demo.id }, em)).resolves.toBe(true)
      await expect(deletedService.recover({ id: errorSnapshot.id, deletedId: error.id }, em)).resolves.toBe(true)
      await expect(deletedService.recover({ id: keySnapshot.id, deletedId: key.id }, em)).resolves.toBe(true)
    }, true)

    // 原行回来：uuid 一致、created_at / updated_at 与快照同刻（jsonb 时间戳直存直取）、业务字段原样
    const recoveredDemo = await demoRepo.readById(demo.id)
    expect(recoveredDemo.id).toBe(demo.id)
    expect(recoveredDemo.demoString).toBe(demo.demoString)
    expect(recoveredDemo.createdAt.getTime()).toBe(demo.createdAt.getTime())
    expect(recoveredDemo.updatedAt.getTime()).toBe(demo.updatedAt.getTime())

    const recoveredError = await errorRepo.readById(error.id)
    expect(recoveredError.createdAt.getTime()).toBe(error.createdAt.getTime())
    expect(recoveredError.message).toBe(error.message)

    const recoveredKey = await keyRepo.readById(key.id)
    expect(recoveredKey.createdAt.getTime()).toBe(key.createdAt.getTime())
    expect(recoveredKey.key).toBe(key.key)

    // sys_deleted 行随恢复删除（同事务两步写）
    expect(await pgDataSource.manager.count(SysDeletedEntity, { where: { deletedBy: user.id } })).toBe(0)

    // 清理恢复出来的业务行：集成库串行共享（fileParallelism: false），留下的 ACTIVE
    // JWT_AT key 会污染 app.key.int-spec 的「rotate 无 ACTIVE key → NotFound」前提
    await pgDataSource.manager.delete(AppDemoEntity, { id: demo.id })
    await pgDataSource.manager.delete(AppErrorEntity, { id: error.id })
    await pgDataSource.manager.delete(AppKeyEntity, { id: key.id })
    await pgDataSource.manager.delete(SysUserEntity, { id: user.id })
  })

  it('recover 全量回滚：第一步成功、第二步唯一约束冲突 → force-rollback 后无残留', async () => {
    const first = await demoRepo.create(uniqueDemoPayload())
    const second = await demoRepo.create(uniqueDemoPayload())

    await demoRepo.deleteSoftById(first.id, randomUUID())
    await demoRepo.deleteSoftById(second.id, randomUUID())

    const firstSnapshot = await pgDataSource.manager.findOneByOrFail(SysDeletedEntity, { deletedId: first.id })
    const secondSnapshot = await pgDataSource.manager.findOneByOrFail(SysDeletedEntity, { deletedId: second.id })

    // 受控冲突：与第二份快照同 demoString 的行先落回原表（unique 冲突由 DB 把关）
    const collision = await insertDemoCollision(second.demoString as string)

    await withTx(async (em) => {
      // 第一步恢复成功（事务内可见）
      await expect(deletedService.recover({ id: firstSnapshot.id, deletedId: first.id }, em)).resolves.toBe(true)

      // 第二步撞 demoString 唯一约束 → 受控 recoverFail
      await expect(deletedService.recover({ id: secondSnapshot.id, deletedId: second.id }, em))
        .rejects
        .toThrow(WalnutAdminExceptionBadRequest)
    }, false)

    // force-rollback 后：原表只有手工插入的冲突行（第一步恢复的行不存在），
    // 两份快照原样留在回收站 —— 恢复链路全量回滚、无残留
    expect(await pgDataSource.manager.count(AppDemoEntity, { where: { id: first.id } })).toBe(0)
    expect(await pgDataSource.manager.count(AppDemoEntity, { where: { id: second.id } })).toBe(0)
    expect(await pgDataSource.manager.count(AppDemoEntity, { where: { demoString: first.demoString! } })).toBe(0)
    expect(await pgDataSource.manager.findOne(SysDeletedEntity, { where: { id: firstSnapshot.id } })).not.toBeNull()
    expect(await pgDataSource.manager.findOne(SysDeletedEntity, { where: { id: secondSnapshot.id } })).not.toBeNull()
    expect(await demoRepo.readById(collision.id)).not.toBeNull()

    // 清理：回收站两份快照 + 冲突行
    await deletedService.deleteRealMany([firstSnapshot.id, secondSnapshot.id])
    await pgDataSource.manager.delete(AppDemoEntity, { id: collision.id })
  })

  it('recoverMine：属主可恢复；非属主 BadRequest；id+deletedId 双键定位不命中 DataNotFound', async () => {
    const owner = randomUUID()
    const mine = await demoRepo.create(uniqueDemoPayload())
    await demoRepo.deleteSoftById(mine.id, owner)
    const snapshot = await pgDataSource.manager.findOneByOrFail(SysDeletedEntity, { deletedId: mine.id })

    // 非属主 → BadRequest（属主校验语义原样）
    await withTx(async (em) => {
      await expect(deletedService.recoverMine({ id: snapshot.id, deletedId: mine.id }, randomUUID(), em))
        .rejects
        .toThrow(WalnutAdminExceptionBadRequest)
    }, false)

    // 双键定位：deletedId 不匹配 → DataNotFound（与 Mongo 版 findOne 双条件语义一致）
    await expect(deletedService.recoverMine({ id: snapshot.id, deletedId: randomUUID() }, owner, pgDataSource.manager))
      .rejects
      .toThrow(WalnutAdminExceptionDataNotFound)

    // 属主恢复成功
    await withTx(async (em) => {
      await expect(deletedService.recoverMine({ id: snapshot.id, deletedId: mine.id }, owner, em)).resolves.toBe(true)
    }, true)

    expect(await demoRepo.readById(mine.id)).not.toBeNull()
    expect(await pgDataSource.manager.count(SysDeletedEntity, { where: { id: snapshot.id } })).toBe(0)

    await pgDataSource.manager.delete(AppDemoEntity, { id: mine.id })
  })

  it('未注册 modelName → 受控 recoverFail（不再复刻动态模型的 MissingSchemaError）', async () => {
    const ghostId = randomUUID()
    await pgDataSource.manager.insert(SysDeletedEntity, {
      id: randomUUID(),
      content: { spec: ghostId },
      modelName: 'GhostModel',
      collectionName: 'ghost_collection',
      deletedId: ghostId,
      deletedBy: randomUUID(),
      logOperateId: null,
      deletedAt: new Date(),
    })
    const ghost = await pgDataSource.manager.findOneByOrFail(SysDeletedEntity, { deletedId: ghostId })

    // 受控错误：errMsg 固定 recoverFail，_devMsg 指明未注册的 modelName
    const err = await deletedService.recover({ id: ghost.id, deletedId: ghostId }, pgDataSource.manager)
      .then(() => null)
      .catch((e: WalnutAdminExceptionBadRequest) => e)

    expect(err).toBeInstanceOf(WalnutAdminExceptionBadRequest)
    expect((err!.getResponse() as { errMsg: string }).errMsg).toBe('business.system.delete.recoverFail')
    expect((err!.getResponse() as { _devMsg: string })._devMsg).toContain('GhostModel')

    // 快照未被误删
    expect(await pgDataSource.manager.count(SysDeletedEntity, { where: { id: ghost.id } })).toBe(1)

    await deletedService.deleteRealMany([ghost.id])
  })

  it('彻底删除 deleteRealMany：回收站行消失，原表不回来', async () => {
    const row = await errorRepo.create(uniqueErrorPayload())
    await errorRepo.deleteSoftById(row.id, randomUUID())
    const snapshot = await pgDataSource.manager.findOneByOrFail(SysDeletedEntity, { deletedId: row.id })

    expect(await pgDataSource.manager.count(SysDeletedEntity, { where: { id: snapshot.id } })).toBe(1)

    const removed = await deletedService.deleteRealMany([snapshot.id])
    expect(removed.map(i => i.id)).toEqual([snapshot.id])

    expect(await pgDataSource.manager.count(SysDeletedEntity, { where: { id: snapshot.id } })).toBe(0)
    expect(await pgDataSource.manager.count(AppErrorEntity, { where: { id: row.id } })).toBe(0)
  })
})

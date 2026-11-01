import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { AppKeyBasicRepository, AppKeyEntity, AppKeyService, AppKeyTypeConst } from '@walnut-server/app-domain'

import { WalnutAdminExceptionNotFound } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataExists } from '@walnut-server/exceptions/base/400'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * B4 app_key 轻量用例（phase2 4.23 / phase3-plan §1 B4）：
 * - initFirst：首个 key 落库（uuid 主键 / meta jsonb）+ 唯一性语义（同类型二钻抛
 *   DataExists；uq_key 唯一索引由 DB 兜底）；
 * - rotate：ctx.em 透传路径 —— 当期 ACTIVE 置 DEPRECATED、新 key version+1，事务内
 *   同回滚（rotation 内没有可回滚的中间态暴露）；
 * - rotateForCronJob：手动 Mongo session 事务改 repo.transactional 后语义不变 ——
 *   未到期不转、到期才转、转完当期换人；
 * - getCurrentActiveKey：version 最大的 ACTIVE 行（idx_app_key_status 过滤 + version 排序）。
 *
 * 消费方兼容锚点：security/rsa 的请求解密走 getCurrentActiveKey 的实体 meta（P0-6 后
 * getCurrent 只出公钥）、techniques/task 只调 rotateForCronJob —— 两者出参/行为面本套
 * 用例即守卫。
 */
describe('B4 app_key (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let keyService: AppKeyService
  let keyRepo: AppKeyBasicRepository

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)

    keyService = app.get(AppKeyService)
    keyRepo = app.get(AppKeyBasicRepository)
  })

  afterAll(async () => {
    await app.close()
  })

  it('initFirst：首个 key 落库（uuid 主键 / meta jsonb / validEnd +30d）', async () => {
    const created = await keyService.initFirst(AppKeyTypeConst.RSA_PAIR)

    expect(created!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(created!.type).toBe(AppKeyTypeConst.RSA_PAIR)
    expect(created!.version).toBe(1)
    expect(created!.status).toBe('ACTIVE')
    expect(created!.meta!.publicKeyPem).toContain('BEGIN PUBLIC KEY')
    // P0-6 纵深防御：返回副本源码级剔除私钥（不依赖序列化器单防线）
    expect(created!.meta).not.toHaveProperty('privateKeyPem')
    expect(created!.validEnd!.getTime()).toBeGreaterThan(Date.now())

    // DB 实体仍保留全量 meta（服务端解密通道）
    const row: Array<{ meta: { privateKeyPem?: string } }> = await pgDataSource.query(
      'SELECT meta FROM app_key WHERE id = $1',
      [created!.id],
    )
    expect(row[0].meta.privateKeyPem).toContain('BEGIN PRIVATE KEY')

    // 消费方只读面：getCurrent 出参形态（P0-6：HTTP 视图只含公钥，私钥留实体通道）
    const current = await keyService.getCurrent(AppKeyTypeConst.RSA_PAIR)
    expect(current.publicKeyPem).toBe(created!.meta!.publicKeyPem)
    expect(current).not.toHaveProperty('privateKeyPem')
    // 实体通道：initFirst 返回的是公开副本（P0-6 纵深防御），DB 实体仍持有自己的私钥
    expect((await keyService.getCurrentActiveKey(AppKeyTypeConst.RSA_PAIR))!.meta!.privateKeyPem)
      .toContain('BEGIN PRIVATE KEY')
  })

  it('唯一键语义：同类型 initFirst 二钻抛 DataExists；uq_key 由 DB 约束兜底', async () => {
    await expect(keyService.initFirst(AppKeyTypeConst.RSA_PAIR))
      .rejects
      .toThrow(WalnutAdminExceptionDataExists)

    // uq_key 唯一索引（phase2 4.23）：同 key 值插入被 DB 拒绝
    const repo = pgDataSource.getRepository(AppKeyEntity)
    const existed = await repo.findOne({ where: { type: AppKeyTypeConst.RSA_PAIR } })
    await expect(repo.insert({
      key: existed!.key,
      type: AppKeyTypeConst.AES_KEY_URL,
      version: 1,
      validStart: new Date(),
    })).rejects.toThrow()
  })

  it('rotate：当期置 DEPRECATED + 新 key version+1（em 透传，controller ctx.em 同路径）', async () => {
    const before = await keyService.getCurrentActiveKey(AppKeyTypeConst.RSA_PAIR)

    await keyRepo.transactional(async (em) => {
      const next = await keyService.rotate(AppKeyTypeConst.RSA_PAIR, em)
      expect(next!.version).toBe(before!.version + 1)
      expect(next!.status).toBe('ACTIVE')
    })

    // 旧 key 已 DEPRECATED、当期换成新 key
    const old = await pgDataSource.getRepository(AppKeyEntity).findOne({ where: { id: before!.id } })
    expect(old!.status).toBe('DEPRECATED')
    const current = await keyService.getCurrentActiveKey(AppKeyTypeConst.RSA_PAIR)
    expect(current!.id).not.toBe(before!.id)
    expect(current!.version).toBe(before!.version + 1)
  })

  it('rotate 无 ACTIVE key → NotFound', async () => {
    await expect(keyService.rotate(AppKeyTypeConst.JWT_AT))
      .rejects
      .toThrow(WalnutAdminExceptionNotFound)
  })

  it('rotateForCronJob：未到期不转（合法 key 不产生新版本）', async () => {
    await keyService.initFirst(AppKeyTypeConst.AES_KEY_URL)
    const before = await keyService.getCurrentActiveKey(AppKeyTypeConst.AES_KEY_URL)

    await keyService.rotateForCronJob(AppKeyTypeConst.AES_KEY_URL)

    const after = await keyService.getCurrentActiveKey(AppKeyTypeConst.AES_KEY_URL)
    expect(after!.id).toBe(before!.id)
  })

  it('rotateForCronJob：到期 key 触发轮转，事务内完成「废弃 + 换新」', async () => {
    const repo = pgDataSource.getRepository(AppKeyEntity)
    const before = await keyService.getCurrentActiveKey(AppKeyTypeConst.AES_KEY_URL)

    // 把当期 key 的 validEnd 拨到过去（模拟到期）
    await repo.update({ id: before!.id }, { validEnd: AppDayjs().subtract(1, 'day').toDate() })

    await keyService.rotateForCronJob(AppKeyTypeConst.AES_KEY_URL)

    const old = await repo.findOne({ where: { id: before!.id } })
    expect(old!.status).toBe('DEPRECATED')

    const current = await keyService.getCurrentActiveKey(AppKeyTypeConst.AES_KEY_URL)
    expect(current!.id).not.toBe(before!.id)
    expect(current!.version).toBe(before!.version + 1)
    expect(current!.validEnd!.getTime()).toBeGreaterThan(Date.now())

    // 消费方只读面：AES 的 getCurrent 出参（keyB64）
    const meta = await keyService.getCurrent(AppKeyTypeConst.AES_KEY_URL)
    expect(meta.keyB64).toBe(current!.meta!.keyB64)
  })

  it('rotateForCronJob 并发：两路同 tick 只轮换一次（事务内 FOR UPDATE 重判过期，W2-A）', async () => {
    const repo = pgDataSource.getRepository(AppKeyEntity)
    const before = await keyService.getCurrentActiveKey(AppKeyTypeConst.AES_KEY_URL)

    // 再把当期 key 拨到过期，模拟 api + worker 两个进程同一 tick 同时触发
    await repo.update({ id: before!.id }, { validEnd: AppDayjs().subtract(1, 'minute').toDate() })

    await Promise.all([
      keyService.rotateForCronJob(AppKeyTypeConst.AES_KEY_URL),
      keyService.rotateForCronJob(AppKeyTypeConst.AES_KEY_URL),
    ])

    const rows = await repo.find({ where: { type: AppKeyTypeConst.AES_KEY_URL }, order: { version: 'ASC' } })

    // 只产生一个 v+1：后进者等锁后重读到先者新插入的 ACTIVE 行（未到期）→ 跳过，
    // 不会把新 key 再 DEPRECATE 并插 v+2（旧实现的双重轮换缺陷）。
    // 注：两路的时序交错不唯一（后进者也可能重读不到旧 ACTIVE 行而直接跳过），
    // 但无论哪种交错都不会产生 v+2 —— 断言看结果集合，不依赖某一种交错。
    expect(rows.filter(row => row.version > before!.version)).toHaveLength(1)
    expect(rows.filter(row => row.version === before!.version + 1)).toHaveLength(1)

    const current = await keyService.getCurrentActiveKey(AppKeyTypeConst.AES_KEY_URL)
    expect(current!.version).toBe(before!.version + 1)
    expect(current!.status).toBe('ACTIVE')
  })
})

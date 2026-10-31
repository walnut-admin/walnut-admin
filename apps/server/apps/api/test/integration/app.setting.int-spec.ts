import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'

import { AppSettingRepositoryService, AppSettingService } from '@walnut-server/app-domain'

import { AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * B4 app_setting 轻量用例（phase2 4.19 / phase3-plan §1 B4）：
 * - 基础 CRUD/list 走 PG 版 basic repository（uuid 主键）；
 * - findAppSettingByKey / updateAppSettingByKey：uq_setting_key 语义 + value JSON 往返；
 * - 缓存刷新链路只换数据源（cache key APP_SETTING 与触发点不动）：create/update 后
 *   缓存里的 { settingKey → settingValue } 映射跟着变（刷新恰好一次的触发语义）。
 */
describe('B4 app_setting (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let settingService: AppSettingService
  let settingRepoService: AppSettingRepositoryService
  let cacheService: AppTechCacheService

  function uniquePayload() {
    const seed = randomUUID().replaceAll('-', '').slice(0, 8)

    return {
      settingName: `int-spec-setting-${seed}`,
      settingKey: `intspec.setting.${seed}`,
      settingValue: JSON.stringify({ seed }),
      settingType: 'global' as const,
      remark: 'B4 int-spec',
    }
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)

    settingService = app.get(AppSettingService)
    settingRepoService = app.get(AppSettingRepositoryService)
    cacheService = app.get(AppTechCacheService)
  })

  afterAll(async () => {
    // 缓存是全局 key（与 dev 共用 Redis），用例写入后清场
    await cacheService.del(WalnutAdminConstAppCacheKeys.APP_SETTING)
    await app.close()
  })

  it('create → read：uuid 主键回带，PG 版 basic repository CRUD', async () => {
    const payload = uniquePayload()

    const created = await settingService.create(payload)
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(created.settingKey).toBe(payload.settingKey)
    expect(created.createdAt).toBeInstanceOf(Date)

    const read = await settingService.read(created.id)
    expect(read.id).toBe(created.id)
    expect(read.settingValue).toBe(payload.settingValue)

    const updated = await settingService.update(created.id, {
      settingName: payload.settingName,
      settingKey: payload.settingKey,
      settingValue: JSON.stringify({ seed: 'v2' }),
      settingType: payload.settingType,
    })
    expect(updated.settingValue).toBe(JSON.stringify({ seed: 'v2' }))

    const listed = await settingService.list({ query: { settingKey: payload.settingKey } } as never)
    expect(listed.total).toBe(1)
    expect(listed.data[0].settingValue).toBe(JSON.stringify({ seed: 'v2' }))
  })

  it('findAppSettingByKey / updateAppSettingByKey：uq_setting_key 点查 + value JSON 往返 + 事务外就地刷新缓存', async () => {
    const payload = uniquePayload()
    await settingService.create(payload)

    const found = await settingRepoService.findAppSettingByKey<Record<string, string>>(payload.settingKey)
    expect(found).toEqual({ seed: (JSON.parse(payload.settingValue) as { seed: string }).seed })

    // 按 key 更新（findOne + save 语义，updated_at 随 save 前进）
    await settingRepoService.updateAppSettingByKey(payload.settingKey, JSON.stringify({ seed: 'v3' }))
    expect(await settingRepoService.findAppSettingByKey(payload.settingKey)).toEqual({ seed: 'v3' })

    // 查无此 key：读侧 null，写侧静默无操作（对齐 Mongo findOneAndUpdate 行为）
    expect(await settingRepoService.findAppSettingByKey('intspec.not-exist')).toBeNull()
    await expect(settingRepoService.updateAppSettingByKey('intspec.not-exist', 'x')).resolves.toBeUndefined()
  })

  it('缓存刷新链路：create/update 触发 extract 后，APP_SETTING 缓存映射跟着变（key 与触发点不动，只换数据源）', async () => {
    const payload = uniquePayload()

    // 先手动铺一次缓存（模拟启动时的 extract 基线）
    await settingRepoService.extractAppSettingIntoCache()
    const before = await cacheService.get<Record<string, string>>(WalnutAdminConstAppCacheKeys.APP_SETTING)
    expect(before?.[payload.settingKey]).toBeUndefined()

    // create → service 内部刷新缓存 → 缓存里出现新 key
    const created = await settingService.create(payload)
    const afterCreate = await cacheService.get<Record<string, string>>(WalnutAdminConstAppCacheKeys.APP_SETTING)
    expect(afterCreate?.[payload.settingKey]).toBe(payload.settingValue)

    // update → 再次刷新 → 缓存值同步更新
    await settingService.update(created.id, {
      settingName: payload.settingName,
      settingKey: payload.settingKey,
      settingValue: JSON.stringify({ seed: 'v4' }),
      settingType: payload.settingType,
    })
    const afterUpdate = await cacheService.get<Record<string, string>>(WalnutAdminConstAppCacheKeys.APP_SETTING)
    expect(afterUpdate?.[payload.settingKey]).toBe(JSON.stringify({ seed: 'v4' }))

    // updateAppSettingByKey（ip 黑名单链路同款入口）→ runAfterCommit 无事务上下文就地刷新
    await settingRepoService.updateAppSettingByKey(payload.settingKey, JSON.stringify({ seed: 'v5' }))
    const afterKeyUpdate = await cacheService.get<Record<string, string>>(WalnutAdminConstAppCacheKeys.APP_SETTING)
    expect(afterKeyUpdate?.[payload.settingKey]).toBe(JSON.stringify({ seed: 'v5' }))

    // 数据源确实是 PG（Mongo 集成库里没有这行）
    const count = await pgDataSource.manager.query<Array<{ c: number }>>('SELECT count(*)::int AS c FROM app_setting WHERE setting_key = $1', [payload.settingKey])
    expect(count[0].c).toBe(1)
  })

  it('getAuthSettings / getFrontendSettings：缓存读侧出参形态不变（布尔收敛）', async () => {
    const auth = await settingService.getAuthSettings()
    expect(auth).toHaveProperty('email')
    expect(auth).toHaveProperty('qrcode')
    expect(auth.opaque).toHaveProperty('enable')

    const frontend = await settingService.getFrontendSettings()
    expect(typeof frontend.fullScreen).toBe('boolean')
  })
})

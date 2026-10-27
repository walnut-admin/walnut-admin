import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'

import { Locale } from '@walnut/contract'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  colorModeConst,
  fontSizeConst,
  layoutModeConst,
} from '@/modules/system/user_preference/preference.const'
import { SysUserPreferenceService } from '@/modules/system/user_preference/services/user_preference.service'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'

/**
 * B7b 改写（原 Mongo 版 characterization 退役，行为基准已在 git 历史存档）：
 * `SysUserPreferenceService` 的 upsert 三态 —— `findOneAndUpdate(..., { upsert: true })`
 * 的语义在 PG 侧由 `INSERT ... ON CONFLICT (user_id) DO UPDATE` 承接，断言语义保留：
 * - 首次写入：插入一行，未提供列落 DB 默认值（对齐 Mongo schema 默认值）；
 * - 二次写入：更新而非新建（count 不变）；
 * - 无记录读取：返回默认偏好且不落库。
 * 另覆盖 updateLayout 的 jsonb orUpdate 往返与 bindPreferenceForUser 的幂等。
 */
describe('SysUserPreferenceService upsert (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let service: SysUserPreferenceService

  /** 每例播种一个真实 user 行（user_id FK → sys_user），返回 uuid */
  async function seedUser(): Promise<string> {
    const rows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [`pref-spec-${randomUUID()}`],
    )
    return rows[0].id
  }

  async function countByUserId(userId: string): Promise<number> {
    const rows: Array<{ c: number }> = await pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_preference WHERE user_id = $1',
      [userId],
    )
    return rows[0].c
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    service = app.get(SysUserPreferenceService)
  })

  afterAll(async () => {
    // 清场：preference 行随 user CASCADE，连带清掉本spec播种的 user
    await pgDataSource.query('DELETE FROM sys_user WHERE user_name LIKE $1', ['pref-spec-%'])
    await app.close()
  })

  it('无记录时 getPreferenceForUser 返回默认偏好，且不落库', async () => {
    const userId = await seedUser()

    const preference = await service.getPreferenceForUser(userId)

    expect(preference.basic.locale).toBe(Locale.zh_CN)
    expect(preference.accessibility.fontSize).toBe(fontSizeConst[14])
    expect(preference.accessibility.reducedMotion).toBe(false)
    expect(preference.accessibility.colorMode).toBe(colorModeConst.DEFAULT)
    expect(preference.theme.dark).toBe(false)
    expect(preference.layout.layoutMode).toBe(layoutModeConst.LEFT_MENU)

    // 默认偏好只是内存返回，数据库里没有记录
    expect(await countByUserId(userId)).toBe(0)
  })

  it('updateBasic 首次调用：upsert 插入一条，未提供列落 DB 默认值', async () => {
    const userId = await seedUser()

    expect(await countByUserId(userId)).toBe(0)

    await service.updateBasic(userId, { locale: Locale.en_US })

    expect(await countByUserId(userId)).toBe(1)

    const preference = await service.getPreferenceForUser(userId)
    expect(preference.basic.locale).toBe(Locale.en_US)
    // 其余字段仍是默认值
    expect(preference.theme.dark).toBe(false)
    expect(preference.layout.layoutMode).toBe(layoutModeConst.LEFT_MENU)
  })

  it('updateBasic 二次调用：更新而不新建（count 不变）', async () => {
    const userId = await seedUser()

    await service.updateBasic(userId, { locale: Locale.en_US })
    expect(await countByUserId(userId)).toBe(1)

    await service.updateBasic(userId, { locale: Locale.zh_CN })
    expect(await countByUserId(userId)).toBe(1)

    const preference = await service.getPreferenceForUser(userId)
    expect(preference.basic.locale).toBe(Locale.zh_CN)
  })

  it('updateLayout：jsonb 布局对象经 ON CONFLICT DO UPDATE 往返无损，其余列不动', async () => {
    const userId = await seedUser()

    const layout = {
      header: { inverted: false },
      tabs: { showIcon: false, styleMode: 'chrome' },
      menu: { collapseMode: 'head' },
    }

    await service.updateLayout(userId, { layoutMode: 'top-menu', layout })

    const preference = await service.getPreferenceForUser(userId)
    expect(preference.layout.layoutMode).toBe('top-menu')
    expect(preference.layout.layout).toEqual(layout)

    // 部分列更新互不污染：updateTheme 只回写 dark，layout 两列不动
    await service.updateTheme(userId, { dark: true })

    const preference2 = await service.getPreferenceForUser(userId)
    expect(preference2.theme.dark).toBe(true)
    expect(preference2.layout.layoutMode).toBe('top-menu')
    expect(preference2.layout.layout).toEqual(layout)

    const layout2 = { header: { inverted: true } }
    await service.updateLayout(userId, { layoutMode: 'left-menu', layout: layout2 })

    const preference3 = await service.getPreferenceForUser(userId)
    expect(preference3.layout.layoutMode).toBe('left-menu')
    expect(preference3.layout.layout).toEqual(layout2)
    expect(preference3.theme.dark).toBe(true)
  })

  it('bindPreferenceForUser：首次建行，再次返回 false 不重复建', async () => {
    const userId = await seedUser()

    const created = await service.bindPreferenceForUser(userId)
    expect(created).not.toBe(false)
    expect(await countByUserId(userId)).toBe(1)

    expect(await service.bindPreferenceForUser(userId)).toBe(false)
    expect(await countByUserId(userId)).toBe(1)
  })

  it('userId 为空串：直接返回默认偏好（不查库）', async () => {
    const preference = await service.getPreferenceForUser('')

    expect(preference.basic.locale).toBe(Locale.zh_CN)
    expect(preference.accessibility.fontSize).toBe(fontSizeConst[14])
  })
})

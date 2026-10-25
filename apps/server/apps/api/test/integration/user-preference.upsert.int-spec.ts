import type { INestApplication } from '@nestjs/common'
import { WalnutDBCollectionName } from '@walnut-server/db'
import { Locale } from '@walnut/contract'
import { Types } from 'mongoose'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  colorModeConst,
  fontSizeConst,
  layoutModeConst,
} from '@/modules/system/user_preference/schema/user_preference.schema'
import { SysUserPreferenceService } from '@/modules/system/user_preference/services/user_preference.service'
import { createIntegrationApp, getWalnutConnection } from './helpers/create-integration-app'

/**
 * 基线（characterization）：`SysUserPreferenceService` 的 upsert 现状 ——
 * `findOneAndUpdate(..., { upsert: true })` 的首插/更新语义与默认偏好形状，
 * 作为 PG 侧 upsert（INSERT ... ON CONFLICT）的行为对比基准。
 */
describe('SysUserPreferenceService upsert (characterization on real MongoDB)', () => {
  let app: INestApplication
  let service: SysUserPreferenceService
  let preferenceCollection: ReturnType<ReturnType<typeof getWalnutConnection>['collection']>

  function newUserId(): string {
    return new Types.ObjectId().toString()
  }

  async function countByUserId(userId: string): Promise<number> {
    return preferenceCollection.countDocuments({ userId: new Types.ObjectId(userId) })
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    service = app.get(SysUserPreferenceService)
    preferenceCollection = getWalnutConnection(app).collection(WalnutDBCollectionName.USER_PREFERENCE)
  })

  afterAll(async () => {
    await app.close()
  })

  it('无记录时 getPreferenceForUser 返回默认偏好，且不落库', async () => {
    const userId = newUserId()

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

  it('updateBasic 首次调用：upsert 插入一条', async () => {
    const userId = newUserId()

    expect(await countByUserId(userId)).toBe(0)

    await service.updateBasic(userId, { locale: Locale.en_US })

    expect(await countByUserId(userId)).toBe(1)

    const preference = await service.getPreferenceForUser(userId)
    expect(preference.basic.locale).toBe(Locale.en_US)
    // 其余字段仍是 schema 默认值
    expect(preference.theme.dark).toBe(false)
    expect(preference.layout.layoutMode).toBe(layoutModeConst.LEFT_MENU)
  })

  it('updateBasic 二次调用：更新而不新建（count 不变）', async () => {
    const userId = newUserId()

    await service.updateBasic(userId, { locale: Locale.en_US })
    expect(await countByUserId(userId)).toBe(1)

    await service.updateBasic(userId, { locale: Locale.zh_CN })
    expect(await countByUserId(userId)).toBe(1)

    const preference = await service.getPreferenceForUser(userId)
    expect(preference.basic.locale).toBe(Locale.zh_CN)
  })

  it('userId 为空串：直接返回默认偏好（不查库）', async () => {
    const preference = await service.getPreferenceForUser('')

    expect(preference.basic.locale).toBe(Locale.zh_CN)
    expect(preference.accessibility.fontSize).toBe(fontSizeConst[14])
  })
})

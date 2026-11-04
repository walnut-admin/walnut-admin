import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'

/**
 * C 段：`system/user/preference` —— GET read（Lock/Sign/MFA/Device/Ip 全 Free +
 * JwtOptional：匿名也 20000，回全局默认形态）+ PATCH basic/accessibility/theme/layout
 * 四段 upsert（ON CONFLICT (user_id) 只回写 payload 携带的列）→ 再 read 断言持久化。
 *
 * 默认形态两套来源：无行时 service getDefaultPreference（locale zh_CN、fontSize 14、
 * layoutMode left-menu、layout 完整状态袋）；部分 PATCH 后其余段保持 —— 未提交列不回写。
 */

interface PreferenceShape {
  basic: { locale: string }
  accessibility: { fontSize: number, reducedMotion: boolean, colorMode: string, CVD: string | null }
  theme: { dark: boolean }
  layout: { layoutMode: string, layout: Record<string, unknown> }
}

describe('C 段：system/user/preference read + 四段 PATCH upsert（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `pref-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user_preference WHERE user_id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('read 无行 → 全局默认形态；匿名（JwtOptional）同样 20000', async () => {
    const res = await api.root('GET', api.apiPath('/system/user/preference/read'))
    expectOk(res, 'preference read default')

    const data = bodyOf<PreferenceShape>(res).data
    expect(data.basic.locale).toBe('zh_CN')
    expect(data.accessibility).toEqual({ fontSize: 14, reducedMotion: false, colorMode: 'default', CVD: 'default' })
    expect(data.theme).toEqual({ dark: false })
    expect(data.layout.layoutMode).toBe('left-menu')
    // layout 状态袋默认形态
    expect((data.layout.layout as { header?: { inverted?: boolean } }).header?.inverted).toBe(true)

    // Sign/Device/Ip/MFA 全 Free + JwtOptional：unsigned 匿名同样可达（无用户 → 同一默认）
    const anonRes = await api.unsigned('GET', api.apiPath('/system/user/preference/read'))
    expectOk(anonRes, 'preference read anonymous')
    expect(bodyOf<PreferenceShape>(anonRes).data).toEqual(data)
  })

  it('PATCH basic → locale 持久化并建行', async () => {
    const res = await api.root('PATCH', api.apiPath('/system/user/preference/basic'), {
      locale: 'en_US',
    })
    expectOk(res, 'preference basic patch')
    expect(bodyOf<boolean>(res).data).toBe(true)

    const rows: Array<{ locale: string }> = await api.pgDataSource.query(
      'SELECT locale FROM sys_user_preference WHERE user_id = $1',
      [fixture!.userId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].locale).toBe('en_US')

    const readRes = await api.root('GET', api.apiPath('/system/user/preference/read'))
    expect(bodyOf<PreferenceShape>(readRes).data.basic.locale).toBe('en_US')
    // 未提交段走 DB 默认值（行新建，非 service 全默认）
    expect(bodyOf<PreferenceShape>(readRes).data.theme.dark).toBe(false)
  })

  it('PATCH accessibility → 只回写携带列，basic.locale 不丢', async () => {
    const res = await api.root('PATCH', api.apiPath('/system/user/preference/accessibility'), {
      fontSize: 16,
      reducedMotion: true,
      colorMode: 'grayscale',
      CVD: 'protanopia',
    })
    expectOk(res, 'preference accessibility patch')

    const readRes = await api.root('GET', api.apiPath('/system/user/preference/read'))
    const data = bodyOf<PreferenceShape>(readRes).data
    expect(data.accessibility).toEqual({ fontSize: 16, reducedMotion: true, colorMode: 'grayscale', CVD: 'protanopia' })
    // 冲突路径只回写 payload 携带的列
    expect(data.basic.locale).toBe('en_US')
  })

  it('PATCH theme → dark 翻转持久化', async () => {
    const res = await api.root('PATCH', api.apiPath('/system/user/preference/theme'), { dark: true })
    expectOk(res, 'preference theme patch')

    const readRes = await api.root('GET', api.apiPath('/system/user/preference/read'))
    expect(bodyOf<PreferenceShape>(readRes).data.theme.dark).toBe(true)
  })

  it('PATCH layout → layoutMode + jsonb 状态袋整体写入并回读', async () => {
    const layoutBag = {
      header: { inverted: false },
      tabs: { showIcon: false, styleMode: 'chrome' },
    }
    const res = await api.root('PATCH', api.apiPath('/system/user/preference/layout'), {
      layoutMode: 'top-menu',
      layout: layoutBag,
    })
    expectOk(res, 'preference layout patch')

    const readRes = await api.root('GET', api.apiPath('/system/user/preference/read'))
    const data = bodyOf<PreferenceShape>(readRes).data
    expect(data.layout.layoutMode).toBe('top-menu')
    expect(data.layout.layout).toEqual(layoutBag)
  })

  it('校验失败 → 40099（locale 枚举外 / fontSize 越枚举 / 未知字段）', async () => {
    const badLocale = await api.root('PATCH', api.apiPath('/system/user/preference/basic'), {
      locale: 'fr_FR',
    })
    expect(bodyOf(badLocale).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const badFontSize = await api.root('PATCH', api.apiPath('/system/user/preference/accessibility'), {
      fontSize: 15,
    })
    expect(bodyOf(badFontSize).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const unknownField = await api.root('PATCH', api.apiPath('/system/user/preference/theme'), {
      dark: true,
      notAField: 'boom',
    })
    expect(bodyOf(unknownField).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

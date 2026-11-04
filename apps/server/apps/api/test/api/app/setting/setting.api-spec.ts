import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { AppSettingRepositoryService } from '@walnut-server/app-domain'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'

/**
 * B 段：`app/setting` —— GET public（Lock/Sign/Jwt/Cap/Device 全 Free，匿名可达）+
 * GET private（仅需 JWT 的登录态）+ CRUD 全闭环 + `POST cache/refresh`。
 *
 * 写副作用口径：setting create/update 自身就会触发 extractAppSettingIntoCache（全表
 * 重提取进 `WALNUT_CACHE_APP:SETTING`，全局生效路径）—— 用例只自建 `api-spec-*` 前缀的
 * settingKey，不动 seed 行；afterEach/afterAll 删行后手动再 extract 一次，把缓存还原到
 * 「不含本轮测试行」的现场。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SettingRow {
  id: string
  settingKey?: string
  settingName?: string
  settingValue?: string
  settingType?: string
}

interface SettingListData {
  data: SettingRow[]
  total: number
}

interface PublicSettingsData {
  auth: Record<string, unknown>
  frontend: Record<string, unknown>
}

describe('B 段：app/setting public/private + CRUD + cache/refresh（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  /** 本轮自建 setting 行的 key 前缀（uq_setting_key 唯一索引，前缀即清理判据） */
  const keyPrefix = `api-spec-${seed8}`
  let fixture: WalnutRootUserFixture | null = null
  let userId = ''

  async function extractSettingsCache() {
    // 与 controller cache/refresh 同一条写路径（repo.extractAppSettingIntoCache）
    await app.get(AppSettingRepositoryService).extractAppSettingIntoCache()
  }

  async function deleteCreatedRows() {
    await api.pgDataSource.query('DELETE FROM app_setting WHERE setting_key LIKE $1', [`${keyPrefix}%`])
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `setting-${seed8}`)
    userId = fixture.userId

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterEach(async () => {
    await deleteCreatedRows()
    // 删行后重提取，APP:SETTING 缓存回到不含本轮测试行的现场
    await extractSettingsCache()
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await deleteCreatedRows()
      await extractSettingsCache()
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, userId)
    }
    await app.close()
  })

  function settingPayload(tag: string) {
    return {
      settingKey: `${keyPrefix}.${tag}`,
      settingName: `api-spec setting ${tag}`,
      settingValue: JSON.stringify({ tag, env: 'integration' }),
      settingType: 'functional',
    }
  }

  it('public 端点（匿名 + 全 Free）→ 20000，auth/frontend 全布尔形状', async () => {
    const res = await api.unsigned('GET', api.apiPath('/app/setting/public'))
    expectOk(res, 'setting public')

    const data = bodyOf<PublicSettingsData>(res).data
    // auth 组：email/phone/qrcode/gitee/github/google + opaque 子对象
    for (const key of ['email', 'phone', 'qrcode', 'gitee', 'github', 'google']) {
      expect(typeof data.auth[key]).toBe('boolean')
    }
    expect(typeof (data.auth.opaque as Record<string, unknown>).enable).toBe('boolean')
    // frontend 组：fullScreen/locale/dark/search
    for (const key of ['fullScreen', 'locale', 'dark', 'search']) {
      expect(typeof data.frontend[key]).toBe('boolean')
    }
  })

  it('private 端点：登录态 20000（maskUrl 等四组形状），匿名 40101', async () => {
    const res = await api.root('GET', api.apiPath('/app/setting/private'))
    expectOk(res, 'setting private')

    const data = bodyOf<Record<string, { status?: unknown, mode?: unknown, value?: unknown }>>(res).data
    for (const key of ['maskUrl', 'hijackRefresh', 'watermark', 'transition']) {
      expect(data[key]).toBeTypeOf('object')
      expect('status' in data[key]).toBe(true)
    }

    const anonRes = await api.anon('GET', api.apiPath('/app/setting/private'))
    expect(bodyOf(anonRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })

  it('CRUD 全闭环：create → read → update → list 过滤', async () => {
    const createRes = await api.root('POST', api.apiPath('/app/setting'), settingPayload('c1'))
    expectOk(createRes, 'setting create')
    const created = bodyOf<SettingRow>(createRes).data
    expect(created.id).toMatch(UUID_RE)
    expect(created.settingKey).toBe(`${keyPrefix}.c1`)

    const readRes = await api.root('GET', api.apiPath(`/app/setting/${created.id}`))
    expectOk(readRes, 'setting read')
    const row = bodyOf<SettingRow>(readRes).data
    expect(row.id).toBe(created.id)
    expect(row.settingValue).toBe(JSON.stringify({ tag: 'c1', env: 'integration' }))

    const updateRes = await api.root('PUT', api.apiPath(`/app/setting/${created.id}`), {
      settingKey: `${keyPrefix}.c1`,
      settingName: `api-spec setting c1-updated`,
      settingValue: JSON.stringify({ tag: 'c1', env: 'integration', updated: true }),
      settingType: 'functional',
    })
    expectOk(updateRes, 'setting update')

    const rereadRes = await api.root('GET', api.apiPath(`/app/setting/${created.id}`))
    const reread = bodyOf<SettingRow>(rereadRes).data
    expect(reread.settingName).toBe(`api-spec setting c1-updated`)
    expect(JSON.parse(reread.settingValue!)).toMatchObject({ updated: true })

    // 第二行 + list 按 settingKey 子串过滤只命中其一
    const createRes2 = await api.root('POST', api.apiPath('/app/setting'), settingPayload('c2'))
    expectOk(createRes2, 'setting create c2')

    const listRes = await api.root('POST', api.apiPath('/app/setting/list'), {
      filters: [{ field: 'settingKey', op: 'like', value: `${keyPrefix}.c1` }],
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'setting list')
    const list = bodyOf<SettingListData>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].settingKey).toBe(`${keyPrefix}.c1`)
  })

  it('cache/refresh → 20000，写设置经缓存路径全局生效（getAppSettings 可读到本轮行）', async () => {
    const payload = settingPayload('cache')
    const createRes = await api.root('POST', api.apiPath('/app/setting'), payload)
    expectOk(createRes, 'setting create for cache')

    const refreshRes = await api.root('POST', api.apiPath('/app/setting/cache/refresh'))
    expectOk(refreshRes, 'setting cache refresh')
    expect(bodyOf<boolean>(refreshRes).data).toBe(true)

    // 缓存生效路径：extractAppSettingIntoCache 后 { settingKey → settingValue } 全表进缓存
    const cached = await app.get(AppTechCacheAppSettingsService).getAppSettings()
    expect((cached as Record<string, string>)[payload.settingKey]).toBe(payload.settingValue)
  })

  it('校验失败 → 40099（未知字段 forbidNonWhitelisted / settingType 非法枚举）', async () => {
    const unknownField = await api.root('POST', api.apiPath('/app/setting'), {
      ...settingPayload('v1'),
      notAField: 'boom',
    })
    expect(bodyOf(unknownField).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const badType = await api.root('POST', api.apiPath('/app/setting'), {
      ...settingPayload('v2'),
      settingType: 'not-a-type',
    })
    expect(bodyOf(badType).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('未登录 CRUD → 40101（public 端点不受影响）', async () => {
    const res = await api.anon('POST', api.apiPath('/app/setting'), settingPayload('anon'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

    const pub = await api.unsigned('GET', api.apiPath('/app/setting/public'))
    expectOk(pub, 'setting public stays anonymous')
  })
})

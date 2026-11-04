import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'

/**
 * A 段试点：`system/locale` —— 非标 CRUD 全形态（数组批量 create、GET /:key、
 * PUT /:id + oldKey 换 key、DELETE /:key、DELETE /deleteMany/:keys、list）走真实事务，
 * 加 `GET /system/locale/message/:locale?cache=1` 公开端点（全 Free + 响应缓存）。
 *
 * 请求形态钉现状：create/update 的 body 是**单对象** `{ key, [langId-uuid]: value, oldKey? }`，
 * 由 LocalePayloadTransformPipe 展开成按 langId 的数组（同 key 多语言一次提交）；
 * PUT 的路由参数 :id 不参与处理，行定位靠 body.oldKey。
 *
 * message 缓存语义：HTTP create/delete 事务提交后 triggerCacheRefresh 会全量刷新
 * message 缓存（extractLocaleMessagesIntoCacheForCronJob），因此「缓存过期态 vs 新鲜态」
 * 的对拍用 PG 直插行（绕过 refresh）做：cache=1 命中旧缓存，cache=0 回源见新行。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LocaleRow {
  id: string
  key: string
}

interface LocaleListData {
  data: LocaleRow[]
  total: number
}

describe('A 段试点：system/locale 非标 CRUD + message 缓存开关（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let langIdZh = ''
  let langIdOther = ''
  /** seed 层已经带 zh_CN（integration globalSetup 灌入参考数据）——只删本 spec 自己建的行 */
  let langIdZhCreated = false
  let langIdOtherCreated = false
  let fixture: WalnutRootUserFixture | null = null
  let userId = ''

  const keyOf = (tag: string) => `api.spec.${seed8}.${tag}`
  const zhMessageCacheKey = `${WalnutAdminConstAppCacheKeys.SYS_LOCALE_MESSAGES}:ZH_CN`

  /**
   * seed-aware 的 lang fixture：seed 层已含 zh_CN 时复用其 id（不能直接 INSERT，
   * uq_lang 会撞；也不能删它 —— 它挂着 1806 条 seed 语言包，FK CASCADE 会整组带走）。
   */
  async function seedLang(lang: string): Promise<{ id: string, created: boolean }> {
    const rows: Array<{ id: string }> = await api.pgDataSource.query(
      'INSERT INTO sys_lang (lang, description, "sort_order", status) VALUES ($1, $2, 1, true) ON CONFLICT (lang) DO NOTHING RETURNING id',
      [lang, `locale-spec ${seed8}`],
    )
    if (rows.length > 0) {
      return { id: rows[0].id, created: true }
    }
    const existing: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM sys_lang WHERE lang = $1',
      [lang],
    )
    return { id: existing[0].id, created: false }
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    // 固定缓存键跨轮共享（Redis 不随集成库 drop），先清冷态
    await api.cleanupFixedCacheKeys(zhMessageCacheKey, WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `locale-${seed8}`)
    userId = fixture.userId

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // message 端点只认 contract Locale 枚举（zh_CN / en_US）——seed 真名 lang 才能全链打穿
    const zh = await seedLang('zh_CN')
    langIdZh = zh.id
    langIdZhCreated = zh.created
    const other = await seedLang(`x${seed8}`)
    langIdOther = other.id
    langIdOtherCreated = other.created
  })

  afterEach(async () => {
    await api.pgDataSource.query('DELETE FROM sys_locale WHERE key LIKE $1', [`api.spec.${seed8}.%`])
    // 软删行已不在 sys_locale，快照行按 content 里的 key 清（jsonb）
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'key\' LIKE $1', [`api.spec.${seed8}.%`])
    await api.cleanupFixedCacheKeys(zhMessageCacheKey, WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      const createdLangIds = [
        ...(langIdZhCreated ? [langIdZh] : []),
        ...(langIdOtherCreated ? [langIdOther] : []),
      ]
      if (createdLangIds.length > 0) {
        await api.pgDataSource.query('DELETE FROM sys_lang WHERE id = ANY($1::uuid[])', [createdLangIds])
      }
      await api.cleanupFixedCacheKeys(zhMessageCacheKey, WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST)
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, userId)
    }
    await app.close()
  })

  it('create（单对象双 lang 批量）→ 20000，两行同落（真实事务）', async () => {
    const res = await api.root('POST', api.apiPath('/system/locale'), {
      key: keyOf('k1'),
      [langIdZh]: 'v-zh-k1',
      [langIdOther]: 'v-other-k1',
    })
    expectOk(res, 'locale create')
    const rows = bodyOf<LocaleRow[]>(res).data
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.id).toMatch(UUID_RE)
      expect(row.key).toBe(keyOf('k1'))
    }
  })

  it('create 重复 key → 40001（DataExists）', async () => {
    const first = await api.root('POST', api.apiPath('/system/locale'), {
      key: keyOf('dup'),
      [langIdZh]: 'v-dup',
    })
    expectOk(first, 'locale create dup-1')

    const second = await api.root('POST', api.apiPath('/system/locale'), {
      key: keyOf('dup'),
      [langIdZh]: 'v-dup-2',
    })
    expect(bodyOf(second).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS)
  })

  it('P3-20：body 无任何 langId 键 → 受控 40099（不再 TypeError 兜底 50000）', async () => {
    // 空对象与「只有 key、没有任何 <langId>: value」两种形态都在
    // LocalePayloadTransformPipe 产出空数组 → 校验层受控 40099（service 不再收到空数组）
    for (const payload of [{}, { key: keyOf('no-lang') }]) {
      const res = await api.root('POST', api.apiPath('/system/locale'), payload)
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    }

    // update 走同一条两段式管道，同样受控（oldKey 定位前就拦下）
    const updateRes = await api.root('PUT', api.apiPath(`/system/locale/${langIdZh}`), {
      key: keyOf('no-lang'),
      oldKey: keyOf('no-lang'),
    })
    expect(bodyOf(updateRes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    // 未落任何行
    const rows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_locale WHERE key = $1',
      [keyOf('no-lang')],
    )
    expect(rows[0].c).toBe(0)
  })

  it('GET /:key → { [langId]: value, key } 形态', async () => {
    const createRes = await api.root('POST', api.apiPath('/system/locale'), {
      key: keyOf('k2'),
      [langIdZh]: 'v-zh-k2',
      [langIdOther]: 'v-other-k2',
    })
    expectOk(createRes, 'locale create k2')

    const readRes = await api.root('GET', api.apiPath(`/system/locale/${keyOf('k2')}`))
    expectOk(readRes, 'locale read')
    const row = bodyOf<Record<string, string>>(readRes).data
    expect(row.key).toBe(keyOf('k2'))
    expect(row[langIdZh]).toBe('v-zh-k2')
    expect(row[langIdOther]).toBe('v-other-k2')
  })

  it('PUT /:id（oldKey 定位换 key + 改值）→ 20000，旧 key 消失新 key 生效', async () => {
    const createRes = await api.root('POST', api.apiPath('/system/locale'), {
      key: keyOf('k3'),
      [langIdZh]: 'v-zh-k3',
    })
    expectOk(createRes, 'locale create k3')

    const updateRes = await api.root('PUT', api.apiPath(`/system/locale/${langIdZh}`), {
      key: keyOf('k3-renamed'),
      [langIdZh]: 'v-zh-k3-2',
      oldKey: keyOf('k3'),
    })
    expectOk(updateRes, 'locale update')

    const oldRead = await api.root('GET', api.apiPath(`/system/locale/${keyOf('k3')}`))
    expectOk(oldRead, 'locale read old key')
    expect(bodyOf<Record<string, string>>(oldRead).data[langIdZh]).toBeUndefined()

    const newRead = await api.root('GET', api.apiPath(`/system/locale/${keyOf('k3-renamed')}`))
    expect(bodyOf<Record<string, string>>(newRead).data[langIdZh]).toBe('v-zh-k3-2')
  })

  it('list → 按 key 过滤 + 分页', async () => {
    for (const tag of ['l1', 'l2', 'l3']) {
      const res = await api.root('POST', api.apiPath('/system/locale'), {
        key: keyOf(tag),
        [langIdZh]: `v-${tag}`,
      })
      expectOk(res, `locale create ${tag}`)
    }

    const listRes = await api.root('POST', api.apiPath('/system/locale/list'), {
      // 字符串过滤是 ILIKE 子串（%/_ 被字面量转义，不能自造通配符）
      filters: [{ field: 'key', op: 'like', value: `api.spec.${seed8}` }],
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 2 },
    })
    expectOk(listRes, 'locale list')
    const list = bodyOf<LocaleListData>(listRes).data
    expect(list.total).toBe(3)
    expect(list.data).toHaveLength(2)
    for (const row of list.data) {
      expect(row.key).toContain(`api.spec.${seed8}.`)
    }
  })

  it('DELETE /:key → 软删该 key 全语言行；DELETE /deleteMany/:keys 批量', async () => {
    for (const tag of ['d1', 'd2']) {
      const res = await api.root('POST', api.apiPath('/system/locale'), {
        key: keyOf(tag),
        [langIdZh]: `v-${tag}`,
        [langIdOther]: `v-${tag}-other`,
      })
      expectOk(res, `locale create ${tag}`)
    }

    const deleteRes = await api.root('DELETE', api.apiPath(`/system/locale/${keyOf('d1')}`))
    expectOk(deleteRes, 'locale delete')
    expect(bodyOf<LocaleRow[]>(deleteRes).data).toHaveLength(2) // 双语言行一起删

    const readRes = await api.root('GET', api.apiPath(`/system/locale/${keyOf('d1')}`))
    expect(bodyOf<Record<string, string>>(readRes).data[langIdZh]).toBeUndefined()

    const deleteManyRes = await api.root('DELETE', api.apiPath(`/system/locale/deleteMany/${keyOf('d2')}`))
    expectOk(deleteManyRes, 'locale deleteMany')
    expect(bodyOf<LocaleRow[]>(deleteManyRes).data).toHaveLength(2)
  })

  it('message 端点：HTTP create 后 cache=1 可见（提交后刷新缓存）', async () => {
    const createRes = await api.root('POST', api.apiPath('/system/locale'), {
      key: keyOf('msg'),
      [langIdZh]: 'v-msg-zh',
    })
    expectOk(createRes, 'locale create msg')

    const res = await api.unsigned('GET', api.apiPath('/system/locale/message/zh_CN?cache=1'))
    expectOk(res, 'locale message cache=1')
    expect(bodyOf<Record<string, string>>(res).data[keyOf('msg')]).toBe('v-msg-zh')
    expect(await api.hasWalnutCacheKey(zhMessageCacheKey)).toBe(true)
  })

  it('message 缓存开关两态：cache=1 命中旧缓存（PG 直插行不触发刷新），cache=0 回源见新行', async () => {
    // 热缓存：HTTP create（提交后全量刷新）
    const createRes = await api.root('POST', api.apiPath('/system/locale'), {
      key: keyOf('fresh'),
      [langIdZh]: 'v-fresh',
    })
    expectOk(createRes, 'locale create fresh')

    // PG 直插一行（绕过 HTTP 事务的 triggerCacheRefresh）
    await api.pgDataSource.query(
      'INSERT INTO sys_locale (lang_id, key, value) VALUES ($1, $2, $3)',
      [langIdZh, keyOf('bypass'), 'v-bypass'],
    )

    // cache=1：命中刷新时点的缓存（只有 fresh，没有 bypass）
    const cachedRes = await api.unsigned('GET', api.apiPath('/system/locale/message/zh_CN?cache=1'))
    expectOk(cachedRes, 'locale message cache=1')
    const cachedData = bodyOf<Record<string, string>>(cachedRes).data
    expect(cachedData[keyOf('fresh')]).toBe('v-fresh')
    expect(cachedData[keyOf('bypass')]).toBeUndefined()

    // cache=0：强制回源（bypass 可见）
    const freshRes = await api.unsigned('GET', api.apiPath('/system/locale/message/zh_CN?cache=0'))
    expectOk(freshRes, 'locale message cache=0')
    expect(bodyOf<Record<string, string>>(freshRes).data[keyOf('bypass')]).toBe('v-bypass')
  })

  it('未登录写端点 → 40101；message 端点保持匿名可达', async () => {
    const res = await api.anon('POST', api.apiPath('/system/locale'), {
      key: keyOf('anon'),
      [langIdZh]: 'v-anon',
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

    const msg = await api.unsigned('GET', api.apiPath('/system/locale/message/zh_CN?cache=0'))
    expectOk(msg, 'locale message stays anonymous')
  })
})

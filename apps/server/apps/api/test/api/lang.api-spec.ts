import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * A 段试点：`system/lang` —— CRUD 四件（无 delete 端点）+ `GET /system/lang/list/public`
 * 全 Free 公开端点（@WalnutAdminDecoratorCache 响应缓存路径，键
 * `WALNUT_CACHE_SYSTEM:LANGUAGE:PUBLIC_LIST`）。
 *
 * 缓存语义（P2-5 修复后，2026-10-28）：public 端点首次回源后 1h TTL，lang
 * create/update 挂 after-commit 失效（runAfterCommit 通道，对齐 locale 的全量刷新
 * 形态）—— CRUD 返回后下一次 public 请求立见新值。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LangRow {
  id: string
  lang?: string
  description?: string
  status?: boolean
}

interface LangListData {
  data: LangRow[]
  total: number
}

describe('A 段试点：system/lang CRUD + public 响应缓存（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  /** 本轮 lang 代码（varchar(16)，uq_lang 唯一索引） */
  const langCodeA = `z${seed8}` // 14 字符
  const langCodeB = `y${seed8}b`
  let fixture: WalnutRootUserFixture | null = null
  let userId = ''

  const publicCacheKey = WalnutAdminConstAppCacheKeys.SYS_LANG_LIST_PUBLIC

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    // 缓存键跨轮共享（Redis 不随集成库 drop）——先清掉上一轮残留，保证缓存路径断言从冷态开始
    await api.cleanupFixedCacheKeys(publicCacheKey, WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `lang-${seed8}`)
    userId = fixture.userId

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterEach(async () => {
    await api.pgDataSource.query('DELETE FROM sys_lang WHERE lang = ANY($1::text[])', [[langCodeA, langCodeB]])
    await api.cleanupFixedCacheKeys(publicCacheKey)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupFixedCacheKeys(publicCacheKey, WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST)
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, userId)
    }
    await app.close()
  })

  it('public 端点（匿名 + 全 Free）→ 20000 数组，且写入响应缓存键', async () => {
    const res = await api.unsigned('GET', api.apiPath('/system/lang/list/public'))
    expectOk(res, 'lang list public')
    const first = bodyOf<LangRow[]>(res).data
    expect(Array.isArray(first)).toBe(true)

    // 缓存装饰器路径：首次回源后写 WALNUT_CACHE_<key>
    expect(await api.hasWalnutCacheKey(publicCacheKey)).toBe(true)

    // 第二次命中缓存（不回源）——响应仍 20000；内容与首次一致（缓存复用）
    const cached = await api.unsigned('GET', api.apiPath('/system/lang/list/public'))
    expectOk(cached, 'lang list public (cached)')
    expect(bodyOf<LangRow[]>(cached).data).toEqual(first)
  })

  it('create → 20000；read 回读一致（含 locale 计数）', async () => {
    const createRes = await api.root('POST', api.apiPath('/system/lang'), {
      lang: langCodeA,
      description: `api-spec lang ${seed8}`,
      order: 1,
      status: true,
    })
    expectOk(createRes, 'lang create')
    const created = bodyOf<LangRow>(createRes).data
    expect(created.id).toMatch(UUID_RE)

    const readRes = await api.root('GET', api.apiPath(`/system/lang/${created.id}`))
    expectOk(readRes, 'lang read')
    const row = bodyOf<LangRow>(readRes).data
    expect(row.id).toBe(created.id)
    expect(row.lang).toBe(langCodeA)
    expect(row.status).toBe(true)
  })

  it('update → 20000，修改持久化（四字段全量提交）', async () => {
    const createRes = await api.root('POST', api.apiPath('/system/lang'), {
      lang: langCodeA,
      description: `api-spec lang ${seed8}`,
      order: 1,
      status: true,
    })
    expectOk(createRes, 'lang create')
    const id = bodyOf<LangRow>(createRes).data.id

    const updateRes = await api.root('PUT', api.apiPath(`/system/lang/${id}`), {
      lang: langCodeA,
      description: `api-spec lang updated ${seed8}`,
      order: 2,
      status: false,
    })
    expectOk(updateRes, 'lang update')

    const readRes = await api.root('GET', api.apiPath(`/system/lang/${id}`))
    const row = bodyOf<LangRow>(readRes).data
    expect(row.description).toBe(`api-spec lang updated ${seed8}`)
    expect(row.status).toBe(false)
  })

  it('list → 按 lang 过滤命中本组行', async () => {
    for (const code of [langCodeA, langCodeB]) {
      const res = await api.root('POST', api.apiPath('/system/lang'), {
        lang: code,
        description: `api-spec lang ${seed8}`,
        order: 1,
        status: true,
      })
      expectOk(res, `lang create ${code}`)
    }

    const listRes = await api.root('POST', api.apiPath('/system/lang/list'), {
      query: { lang: langCodeA },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'lang list')
    const list = bodyOf<LangListData>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].lang).toBe(langCodeA)
  })

  it('CRUD 后 public 端点立见新值（P2-5：create/update 挂 after-commit 缓存失效）', async () => {
    // 先拉一次 public 写缓存（冷态由 afterEach 的 cleanupFixedCacheKeys 保证）
    const beforeRes = await api.unsigned('GET', api.apiPath('/system/lang/list/public'))
    expectOk(beforeRes, 'lang list public before CRUD')
    expect(bodyOf<LangRow[]>(beforeRes).data.some(row => row.lang === langCodeB)).toBe(false)
    expect(await api.hasWalnutCacheKey(publicCacheKey)).toBe(true)

    const createRes = await api.root('POST', api.apiPath('/system/lang'), {
      lang: langCodeB,
      description: `api-spec lang cache ${seed8}`,
      order: 2,
      status: true,
    })
    expectOk(createRes, 'lang create for cache refresh')
    const created = bodyOf<LangRow>(createRes).data

    // create 提交后缓存已失效 → 下一次 public 回源，命中新行
    const afterCreateRes = await api.unsigned('GET', api.apiPath('/system/lang/list/public'))
    expectOk(afterCreateRes, 'lang list public after create')
    expect(bodyOf<LangRow[]>(afterCreateRes).data.some(row => row.lang === langCodeB)).toBe(true)

    const updateRes = await api.root('PUT', api.apiPath(`/system/lang/${created.id}`), {
      lang: langCodeB,
      description: `api-spec lang cache updated ${seed8}`,
      order: 2,
      status: false,
    })
    expectOk(updateRes, 'lang update for cache refresh')

    // update 提交后同样失效 → 新行已停用，public 不再包含
    const afterUpdateRes = await api.unsigned('GET', api.apiPath('/system/lang/list/public'))
    expectOk(afterUpdateRes, 'lang list public after update')
    expect(bodyOf<LangRow[]>(afterUpdateRes).data.some(row => row.lang === langCodeB)).toBe(false)
  })

  it('校验失败 → 40099（未知字段 forbidNonWhitelisted）', async () => {
    const res = await api.root('POST', api.apiPath('/system/lang'), {
      lang: langCodeA,
      description: 'x',
      order: 1,
      status: true,
      notAField: 'boom',
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('未登录 CRUD → 40101（public 端点不受影响）', async () => {
    const res = await api.anon('POST', api.apiPath('/system/lang'), {
      lang: langCodeA,
      description: 'x',
      order: 1,
      status: true,
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

    const pub = await api.unsigned('GET', api.apiPath('/system/lang/list/public'))
    expectOk(pub, 'lang list public stays anonymous')
  })
})

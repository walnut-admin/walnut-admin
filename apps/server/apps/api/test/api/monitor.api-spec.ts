import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * B 段：`app/monitor/cache`（read/list/delete/clear，@HasRole([root,developer]) OR）+
 * `app/monitor/server` 八个只读端点冒烟。
 *
 * 缓存用例：经 AppTechCacheService.set 造真实 Redis 键（`WALNUT_CACHE_<key>`，shared
 * 类型）→ read/list 命中 → delete 后键消失。`clear` 只清非保护类型（built-in/auth/system
 * 豁免）—— 放在最后一个用例：断言本轮 shared 键被清、AUTH 类型的 MFA verified 键幸存；
 * 全局副作用兜底为本 spec 结束后即关闭 app（集成轮内串行，无并行 spec 受影响）。
 *
 * server 用例：cpu/mem/os/sys/disk/battery/time/network 断言形状非空（battery 在无电池
 * 主机上字段可为 null，只断言对象形状）。
 */

const seed8 = randomUUID().slice(0, 8)
/** 本轮造的缓存键（shared 类型，clear 可清；键名即展示名，无 WALNUT_CACHE_ 前缀） */
const cacheKeyA = `MONITOR:APISPEC:${seed8}:A`
const cacheKeyB = `MONITOR:APISPEC:${seed8}:B`

interface CacheListData {
  data: Array<{ key: string, type: string, valueBytes: number }>
  total: number
}

describe('B 段：app/monitor/cache + monitor/server（真实 HTTP 全链 + 真实 Redis 键）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  let cacheService: AppTechCacheService

  let fixture: WalnutRootUserFixture | null = null
  /** MFA verified 缓存键（AUTH 类型，clear 豁免断言用） */
  let mfaCacheKey = ''

  /**
   * delete 端点是 `return void del(key)` 的 fire-and-forget（响应先于 DEL 落 Redis）——
   * 键消失断言带短轮询，钉语义不赌时序
   */
  async function expectKeyGone(key: string, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!(await api.hasWalnutCacheKey(key))) {
        return
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(await api.hasWalnutCacheKey(key)).toBe(false)
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    cacheService = app.get(AppTechCacheService)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `monitor-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    // 借登录后的 MFA 种子键当「clear 豁免」的活体样本
    mfaCacheKey = `AUTH:MFA:VERIFIED:${fixture.userId}:${api.deviceId}`
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.cleanupWalnutCacheKeys(`MONITOR:APISPEC:${seed8}`, api.deviceId, fixture.userId)
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
    }
    await app.close()
  })

  it('cache read → 20000（真实键可点读；响应 value 恒为空对象 —— 钉现状）', async () => {
    await cacheService.set(cacheKeyA, { hello: 'walnut' }, { t: WalnutAdminConstAppCacheType.SHARED, ttl: 3600 })

    const res = await api.root('GET', api.apiPath(`/app/monitor/cache/${cacheKeyA}`))
    expectOk(res, 'monitor cache read')
    // controller 返回 { value: void await get(key) } —— value 是 undefined，JSON 序列化后 data 为 {}
    expect(bodyOf(res).data).toEqual({})
  })

  it('cache list → 按 key 子串过滤命中本轮键，type=shared', async () => {
    const res = await api.root('POST', api.apiPath('/app/monitor/cache/list'), {
      query: { key: `APISPEC:${seed8}` },
      sort: [{ field: 'key', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(res, 'monitor cache list')

    const list = bodyOf<CacheListData>(res).data
    expect(list.total).toBe(1)
    expect(list.data[0].key).toBe(cacheKeyA)
    expect(list.data[0].type).toBe(WalnutAdminConstAppCacheType.SHARED)
    expect(list.data[0].valueBytes).toBeGreaterThan(0)
  })

  it('cache delete → 20000，真实 Redis 键随之消失（fire-and-forget 删除，轮询等待落键）', async () => {
    const res = await api.root('DELETE', api.apiPath(`/app/monitor/cache/${cacheKeyA}`))
    expectOk(res, 'monitor cache delete')

    await expectKeyGone(cacheKeyA)
  })

  it('server 八个只读端点 → 20000，形状非空', async () => {
    const cpu = bodyOf<{ cores: number, brand: string }>(await api.root('GET', api.apiPath('/app/monitor/server/cpu'))).data
    expect(cpu.cores).toBeGreaterThan(0)
    expect(cpu.brand.length).toBeGreaterThan(0)

    // mem 走 @TransformSizeToGB —— 出参是 'x.xx GB' 字符串（钉现状）
    const mem = bodyOf<{ total: string, free: string }>(await api.root('GET', api.apiPath('/app/monitor/server/mem'))).data
    expect(Number.parseFloat(mem.total)).toBeGreaterThan(0)
    expect(Number.parseFloat(mem.free)).toBeGreaterThanOrEqual(0)
    expect(mem.total).toMatch(/ GB$/)

    const os = bodyOf<{ hostname: string, platform: string }>(await api.root('GET', api.apiPath('/app/monitor/server/os'))).data
    expect(os.hostname.length).toBeGreaterThan(0)
    expect(os.platform.length).toBeGreaterThan(0)

    const sys = bodyOf<Record<string, unknown>>(await api.root('GET', api.apiPath('/app/monitor/server/sys'))).data
    expect(Object.keys(sys)).toContain('manufacturer')

    const disk = bodyOf<Array<{ name: string, size: number }>>(await api.root('GET', api.apiPath('/app/monitor/server/disk'))).data
    expect(Array.isArray(disk)).toBe(true)

    const battery = bodyOf<Record<string, unknown>>(await api.root('GET', api.apiPath('/app/monitor/server/battery'))).data
    expect(battery).toBeTypeOf('object')

    const time = bodyOf<Record<string, unknown>>(await api.root('GET', api.apiPath('/app/monitor/server/time'))).data
    expect(Object.keys(time).length).toBeGreaterThan(0)

    const network = bodyOf<{ iface?: string }>(await api.root('GET', api.apiPath('/app/monitor/server/network'))).data
    expect(network).toBeTypeOf('object')
  })

  it('未登录 → 40101（monitor/server 冒烟代表）', async () => {
    const res = await api.anon('GET', api.apiPath('/app/monitor/server/cpu'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })

  it('cache clear → 20000：shared 键被清、AUTH 类型（MFA verified）豁免', async () => {
    // 重造一个 shared 键再 clear（read/delete 用例的键已删，保证 clear 真有目标）
    await cacheService.set(cacheKeyB, { bye: 'walnut' }, { t: WalnutAdminConstAppCacheType.SHARED, ttl: 3600 })
    expect(await api.hasWalnutCacheKey(cacheKeyB)).toBe(true)

    const res = await api.root('DELETE', api.apiPath('/app/monitor/cache/clear'))
    expectOk(res, 'monitor cache clear')
    expect(bodyOf<boolean>(res).data).toBe(true)

    await expectKeyGone(cacheKeyB)
    // built-in/auth/system 豁免清单：AUTH 类型的 MFA verified 键必须在
    expect(await api.hasWalnutCacheKey(mfaCacheKey)).toBe(true)
  })
})

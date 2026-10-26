import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { In } from 'typeorm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SharedAreaEntity } from '@/modules/shared/area/entity/area.entity'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * B 段：`shared/area` children/feedback 只读冒烟（root 直通权限点 system:area:*）。
 *
 * 集成库 shared_area 每轮 drop 后为空表（真实 66 万行 ETL 数据不进集成轮）—— 自建一套
 * 三级行（95 省 → 9501 市 → 950102 区，代码位数字形对齐真实数据的 2/4/6 位，与 int-spec
 * 的 91/77 数据集无交集）。service 按层级把结果整层写进 Redis（`SHARED:AREA:*`，跨轮
 * 共享）—— beforeAll 先清层级缓存保证从冷态回源，afterAll 删行 + 再清缓存。
 *
 * feedback 读端点按真实语义测：向上逐级收集兄弟层组装 depth/isLeaf 回显树（admin 区域
 * 选择器回显形态，int-spec service 层已钉，这里走 HTTP 全链）。
 *
 * 迁移回归：children/feedback 的缓存未命中冷路径曾整层丢字段（B4 把 Mongo `.lean()`
 * 普通对象换成无 @Expose 的 PG 实体，全局 ClassSerializer 剥成 `[{}]`）—— 已在
 * repo.findChildrenByPcode 最小修复（投影回普通对象），本 spec 的冷态 children 与
 * feedback 用例即该修复的回归守卫。
 */

interface AreaRow {
  name: string
  code: string
  pcode: string
}

interface AreaTreeNode extends AreaRow {
  depth: number
  isLeaf: boolean
  children?: AreaTreeNode[]
}

/** 与 int-spec（91/77）无交集的三级数据集 */
const SEED: AreaRow[] = [
  { code: '95', name: 'AP规范省', pcode: '0' },
  { code: '9501', name: 'AP规范市', pcode: '95' },
  { code: '950102', name: 'AP规范区', pcode: '9501' },
]

const AREA_LEVEL_CACHE_KEYS = [
  WalnutAdminConstAppCacheKeys.SHARED_AREA_PROVINCE,
  WalnutAdminConstAppCacheKeys.SHARED_AREA_CITY,
  WalnutAdminConstAppCacheKeys.SHARED_AREA_DISTRICT,
  WalnutAdminConstAppCacheKeys.SHARED_AREA_STREET,
  WalnutAdminConstAppCacheKeys.SHARED_AREA_VILLAGE,
]

describe('B 段：shared/area children + feedback（真实 HTTP 全链 + 自建区划数据）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null

  async function cleanupAreaData() {
    await api.pgDataSource.getRepository(SharedAreaEntity).delete({ code: In(SEED.map(i => i.code)) })
    await api.cleanupFixedCacheKeys(...AREA_LEVEL_CACHE_KEYS)
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `area-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // 层级缓存跨轮共享（Redis 不随集成库 drop）—— 先清掉保证本轮从冷态回源；
    // 行删除防御性清一次（重跑幂等）再插
    const repo = api.pgDataSource.getRepository(SharedAreaEntity)
    await repo.delete({ code: In(SEED.map(i => i.code)) })
    await api.cleanupFixedCacheKeys(...AREA_LEVEL_CACHE_KEYS)
    for (const row of SEED) {
      await repo.insert(row)
    }
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await cleanupAreaData()
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('children?pcode=0 → 顶级省列表含本轮行（字段完整），且写入层级缓存', async () => {
    // 本用例即迁移回归验证：beforeAll 清了层级缓存，这是冷态（缓存未命中回源）请求 ——
    // 回归版本里 repo 返回无 @Expose 的实体实例，被全局 ClassSerializer 剥成 `[{}]`；
    // 修复后（repo 投影普通对象，对齐 Mongo .lean()）字段完整出站
    const res = await api.root('GET', api.apiPath('/shared/area/children?pcode=0'))
    expectOk(res, 'area children top')

    const rows = bodyOf<AreaRow[]>(res).data
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const ours = rows.find(i => i.code === '95')
    expect(ours).toBeDefined()
    expect(ours?.name).toBe('AP规范省')
    expect(ours?.pcode).toBe('0')

    // 缓存路径：首次回源后整层写 SHARED:AREA:PROVINCE
    expect(await api.hasWalnutCacheKey(WalnutAdminConstAppCacheKeys.SHARED_AREA_PROVINCE)).toBe(true)
  })

  it('children?pcode=95 → 本轮市行（隔离子树恰好一行）', async () => {
    const res = await api.root('GET', api.apiPath('/shared/area/children?pcode=95'))
    expectOk(res, 'area children city')

    const rows = bodyOf<AreaRow[]>(res).data
    expect(rows).toHaveLength(1)
    expect(rows[0].code).toBe('9501')
    expect(rows[0].pcode).toBe('95')
  })

  it('feedback 单区划码 → 省→市→区回显树，最深层 isLeaf=true', async () => {
    const res = await api.root('GET', api.apiPath('/shared/area/feedback?codes=950102'))
    expectOk(res, 'area feedback single')

    // feedback 按「同层整层收集」组装——库里可能并存其它 spec 的省级行（如 int-spec 的 91），
    // 根断言按 code 定位本轮省份，不锁数组长度
    const tree = bodyOf<AreaTreeNode[]>(res).data
    expect(tree.length).toBeGreaterThanOrEqual(1)

    const province = tree.find(i => i.code === '95')!
    expect(province).toBeDefined()
    expect(province.depth).toBe(0)
    expect(province.isLeaf).toBe(false)

    const city = province.children!.find(i => i.code === '9501')!
    expect(city.code).toBe('9501')
    expect(city.isLeaf).toBe(false)

    const district = city.children!.find(i => i.code === '950102')!
    expect(district.code).toBe('950102')
    expect(district.depth).toBe(2)
    // 最深返回层级（区层）isLeaf 一致为 true
    expect(district.isLeaf).toBe(true)
  })

  it('feedback 多区划码（逗号分割）→ 合并树以本轮省份为根', async () => {
    const res = await api.root('GET', api.apiPath('/shared/area/feedback?codes=950102,95'))
    expectOk(res, 'area feedback multi')

    const tree = bodyOf<AreaTreeNode[]>(res).data
    const province = tree.find(i => i.code === '95')!
    expect(province).toBeDefined()
    expect(province.depth).toBe(0)

    const city = province.children!.find(i => i.code === '9501')!
    expect(city.code).toBe('9501')
    expect(city.children!.find(i => i.code === '950102')).toBeDefined()
  })

  it('边界：匿名 children → 40101；feedback 缺 codes → 40099', async () => {
    const anonRes = await api.anon('GET', api.apiPath('/shared/area/children?pcode=0'))
    expect(bodyOf(anonRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

    const missingCodes = await api.root('GET', api.apiPath('/shared/area/feedback'))
    expect(bodyOf(missingCodes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

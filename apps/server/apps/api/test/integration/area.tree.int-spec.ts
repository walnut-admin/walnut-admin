import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { SharedAreaBasicRepository, SharedAreaEntity, SharedAreaService } from '@walnut-server/app-domain'

import { AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { In } from 'typeorm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * B4 shared_area 树查询（phase2 5.1 递归 CTE + CYCLE 环保护 / phase3-plan §1 B4）。
 *
 * 集成库的 shared_area 每轮 drop 后为空表，这里插一套小数据集（代码位数字形对齐真实
 * 数据的 2/4/6/9 位），验证 ——
 * - findByCode / findChildrenByPcode：单层查询（日常路径，缓存策略不变）；
 * - findSubtreeByCode + assembleSubtree：多层级子树组装，children 数组形态与 Mongo 版
 *   virtual populate 一致（消费方 admin 区域选择器）；
 * - 限深参数（按需向下 N 层，不做全表加载）；
 * - CYCLE 兜底：集成库直接插入带环数据（77 → 7701 → 77），CTE 借 CYCLE 子句终止，
 *   查询不悬挂，环上重复行标记 is_cycle（数据质量第一道防线是 ETL 环检测，SQL 兜底
 *   是第二道 —— phase2 5.1/7.3）。
 * - service 层换数据源后行为不变：children 缓存链路 + feedback 回显树组装。
 */
describe('B4 shared_area tree (recursive CTE + CYCLE, on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let areaRepo: SharedAreaBasicRepository
  let areaService: SharedAreaService
  let cacheService: AppTechCacheService

  // 小数据集：91(省) → 9101/9102(市) → 910101/910102(区) → 910101001(街道)
  const SEED: Array<{ code: string, name: string, pcode: string }> = [
    { code: '91', name: '测试省', pcode: '0' },
    { code: '9101', name: '测试市一', pcode: '91' },
    { code: '9102', name: '测试市二', pcode: '91' },
    { code: '910101', name: '测试区一', pcode: '9101' },
    { code: '910102', name: '测试区二', pcode: '9101' },
    { code: '910101001', name: '测试街道一', pcode: '910101' },
  ]

  // CYCLE 兜底用的独立角落（与 SEED 无交集）：77 → 7701 → 77
  const CYCLE_SEED: Array<{ code: string, name: string, pcode: string }> = [
    { code: '77', name: '环省', pcode: '0' },
    { code: '7701', name: '环市', pcode: '77' },
  ]

  async function insertRows(rows: Array<{ code: string, name: string, pcode: string }>) {
    const repo = pgDataSource.getRepository(SharedAreaEntity)
    for (const row of rows) {
      await repo.insert(row)
    }
  }

  async function deleteByCodes(codes: string[]) {
    const repo = pgDataSource.getRepository(SharedAreaEntity)
    // 业务键 code 删除（PK 是 uuid，不能按值数组删）
    await repo.delete({ code: In(codes) })
  }

  /** service 层会按 pcode 粒度写 Redis 缓存（与 dev 共用实例），跑完按 key 清场 */
  async function cleanupAreaCache() {
    for (const key of [
      WalnutAdminConstAppCacheKeys.SHARED_AREA_PROVINCE,
      WalnutAdminConstAppCacheKeys.SHARED_AREA_CITY,
      WalnutAdminConstAppCacheKeys.SHARED_AREA_DISTRICT,
      WalnutAdminConstAppCacheKeys.SHARED_AREA_STREET,
      WalnutAdminConstAppCacheKeys.SHARED_AREA_VILLAGE,
    ]) {
      await cacheService.del(key)
    }
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)

    areaRepo = app.get(SharedAreaBasicRepository)
    areaService = app.get(SharedAreaService)
    cacheService = app.get(AppTechCacheService)

    // 集成库 shared_area 每轮 drop 重建为空表；防御性清一次再插（重跑幂等）
    await deleteByCodes([...SEED, ...CYCLE_SEED].map(i => i.code))
    await insertRows(SEED)
  })

  afterAll(async () => {
    await cleanupAreaCache()
    await app.close()
  })

  it('findByCode：uq_area_code 点查，行形态 { id, name, code, pcode }（对齐 B1「PG 响应以 id 为唯一标识」）', async () => {
    const target = await areaRepo.findByCode('910101')

    expect(target).not.toBeNull()
    expect(target!.name).toBe('测试区一')
    expect(target!.code).toBe('910101')
    expect(target!.pcode).toBe('9101')
    expect(target!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('findByCode 查无此码 → null（service 层返回 [] 的前提）', async () => {
    expect(await areaRepo.findByCode('999999')).toBeNull()
  })

  it('findChildrenByPcode：idx_area_pcode 单层查询 + ORDER BY code 确定性排序', async () => {
    const cities = await areaRepo.findChildrenByPcode('91')
    expect(cities.map(i => i.code)).toEqual(['9101', '9102'])

    const districts = await areaRepo.findChildrenByPcode('9101')
    expect(districts.map(i => i.code)).toEqual(['910101', '910102'])

    // 顶层（pcode='0' 约定根值，无 FK —— Q6 定案）
    const provinces = await areaRepo.findChildrenByPcode('0')
    expect(provinces.map(i => i.code)).toEqual(['91'])
  })

  it('findSubtreeByCode 整子树 + assembleSubtree：多层级 children 数组形态与 Mongo virtual populate 一致', async () => {
    const rows = await areaRepo.findSubtreeByCode('91')

    // 6 行（CYCLE_SEED 不在 91 子树内），深度 0/1/1/2/2/3
    expect(rows).toHaveLength(6)
    expect(Object.fromEntries(rows.map(r => [r.code, r.depth]))).toEqual({
      91: 0,
      9101: 1,
      9102: 1,
      910101: 2,
      910102: 2,
      910101001: 3,
    })
    expect(rows.every(r => !r.isCycle)).toBe(true)

    const tree = areaRepo.assembleSubtree(rows)

    expect(tree).toHaveLength(1)
    const province = tree[0]
    expect(province.code).toBe('91')
    expect(province.children.map(i => i.code)).toEqual(['9101', '9102'])

    const city1 = province.children.find(i => i.code === '9101')!
    expect(city1.children.map(i => i.code)).toEqual(['910101', '910102'])
    expect(city1.children[0].children.map(i => i.code)).toEqual(['910101001'])
    // 叶子节点 children 为空数组（Mongo populate 形态：必为数组）
    expect(city1.children[0].children[0].children).toEqual([])
  })

  it('findSubtreeByCode 限深：maxDepth=1 只展开到第一层（按需拉取，不做全表加载）', async () => {
    const rows = await areaRepo.findSubtreeByCode('91', { maxDepth: 1 })

    expect(rows.map(i => i.code).sort()).toEqual(['91', '9101', '9102'])

    const tree = areaRepo.assembleSubtree(rows)
    expect(tree[0].children.map(i => i.code)).toEqual(['9101', '9102'])
    expect(tree[0].children[0].children).toEqual([])
  })

  it('CYCLE 兜底：带环数据（77 → 7701 → 77）下 CTE 终止不悬挂，环回行标记 is_cycle', async () => {
    // 构造环：77 的父亲指向 7701（正常是 0），7701 的父亲是 77
    const repo = pgDataSource.getRepository(SharedAreaEntity)
    await insertRows(CYCLE_SEED)
    await repo.update({ code: '77' }, { pcode: '7701' })

    try {
      // 若 CTE 死循环此 await 永不返回（vitest 按超时判红）
      const rows = await areaRepo.findSubtreeByCode('77')

      const byCode = rows.map(r => ({ code: r.code, depth: r.depth, isCycle: r.isCycle }))

      // 锚点 77 + 子 7701 + 环回的 77（is_cycle=true 标记后终止）
      expect(byCode).toContainEqual({ code: '77', depth: 0, isCycle: false })
      expect(byCode).toContainEqual({ code: '7701', depth: 1, isCycle: false })
      expect(byCode).toContainEqual({ code: '77', depth: 2, isCycle: true })
      // 终止：没有无限深度的行
      expect(Math.max(...rows.map(r => r.depth))).toBeLessThanOrEqual(2)

      // 组装不炸：重复 code 首见为准，环成员（无自然根）按首见提升为根、回边剪除
      const tree = areaRepo.assembleSubtree(rows)
      expect(tree).toHaveLength(1)
      expect(tree[0].code).toBe('77')
      expect(tree[0].children.map(i => i.code)).toEqual(['7701'])
      // 回边已剪除：77 不再出现在 7701 的 children 里，输出无环可序列化
      expect(tree[0].children[0].children).toEqual([])
      expect(() => JSON.stringify(tree)).not.toThrow()
    }
    finally {
      // 拆环并清数据，不污染后续用例
      await repo.update({ code: '77' }, { pcode: '0' })
      await deleteByCodes(CYCLE_SEED.map(i => i.code))
    }
  })

  it('service 层换数据源后行为不变：children 缓存链路出参 { name, code, pcode }', async () => {
    const children = await areaService.getChildrenByPcodeWithCache('91')

    expect(children.map(i => i.code)).toEqual(['9101', '9102'])
    // 行形态 = Mongo `.lean()` 投影（仅 name/code/pcode，不带主键）—— B 段 API 回归
    // 勘误：原 TypeORM find 实体实例会被全局 ClassSerializer（excludeExtraneousValues）
    // 在 HTTP 出站剥成 `{}`（冷路径整层丢字段，见 api/area.api-spec），repo 已改为
    // 投影普通对象，此处同步钉住三字段形态
    expect(Object.keys(children[0]).sort()).toEqual(['code', 'name', 'pcode'])

    // 同参数二次调用走缓存，出参一致
    const again = await areaService.getChildrenByPcodeWithCache('91')
    expect(again.map(i => i.code)).toEqual(['9101', '9102'])
  })

  it('service 层 feedback 回显：向上逐级收集兄弟层并组装 depth/isLeaf 树（admin 区域选择器回显形态）', async () => {
    type IAreaNode = SharedAreaEntity & { depth: number, isLeaf: boolean, children: IAreaNode[] }

    const tree = await areaService.feedback('910101001') as IAreaNode[]

    // 根是省、逐级向下到目标所在街道层；同级兄弟齐全。
    // feedback 按「同层整层收集」——B 段起 api 级 area spec 可能并存自己的省级行
    // （集成库同库共享、文件执行顺序不保证），根断言按 code 定位 91，不锁数组长度
    expect(tree.length).toBeGreaterThanOrEqual(1)
    const province = tree.find(i => i.code === '91')!
    expect(province).toBeDefined()
    expect(province.depth).toBe(0)
    expect(province.isLeaf).toBe(false)

    const city = province.children.find(i => i.code === '9101')!
    expect(city.code).toBe('9101')
    expect(city.isLeaf).toBe(false)

    const district = city.children.find(i => i.code === '910101')!
    expect(district.isLeaf).toBe(false)

    // 最深返回层级（街道层）isLeaf 一致为 true（feedback 场景按最深层判定）
    const street = district.children.find(i => i.code === '910101001')!
    expect(street.code).toBe('910101001')
    expect(street.isLeaf).toBe(true)
    expect(street.depth).toBe(3)
  })
})

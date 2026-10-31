import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import * as process from 'node:process'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * 真实数据只读 suite（默认跑在 seed 层上；`TEST_DATA=real` 时跑在 dev 库全量 dump 上）。
 *
 * 断言口径：**形状 / 包含 / 下界**，不写死精确行数 —— seed 文件与 dev 库会随业务演进
 * （菜单增删、字典扩项），精确计数只会制造脆测试。唯一钉死的清单是 dept/post/employee
 * 的 15 条权限点：它们是本仓 seed 的「组织基础表权限面」，缺失意味着 seed 或映射回归。
 *
 * 只读边界：
 * - HTTP 只发 GET 与 role/list（查询型 POST）；
 * - seed 模式没有 shared_area（seed 集刻意不含 66 万行区划），area 用例直插一层
 *   `98/9801` 两行 fixture 并在 afterAll 按 code 删除 + 清层级缓存；
 * - real 模式直接断言 dev 库真实区划（省份列表 → 首个省份下属市）。
 */

const REAL_MODE = process.env.TEST_DATA === 'real'

/** 本仓 seed 的 dept/post/employee 权限点（`apps/server/db/seed/sys_menu.json`） */
const EXPECTED_ORG_PERMISSIONS = [
  'system:dept:list',
  'system:dept:create',
  'system:dept:read',
  'system:dept:update',
  'system:dept:delete',
  'system:post:list',
  'system:post:create',
  'system:post:read',
  'system:post:update',
  'system:post:delete',
  'system:employee:list',
  'system:employee:create',
  'system:employee:read',
  'system:employee:update',
  'system:employee:delete',
] as const

/** seed 菜单的非根节点数（172 行含 1 个根）；下界留余量，只防「整层丢失」 */
const MENU_NODE_LOWER_BOUND = 150

/**
 * seed 自带角色（root/visitor 不在断言里：root 被各 spec 的 fixture 复用/清理；
 * visitor 在权限链路 spec 的兼容逻辑里也可能被回收 —— 只钉业务角色）
 */
const SEED_ROLE_NAMES = ['admin', 'developer', 'test-home'] as const

/** seed 落地的字典类型（`GET /system/dict/type/s` 入参） */
const SEED_DICT_TYPES = ['sys_shared_status', 'gbt_sex', 'sys_type', 'sys_shared_success'] as const

/** seed 模式自建的两层区划 fixture（真实 GB 码空间里的空闲段） */
const AREA_FIXTURE_PROVINCE = '98'
const AREA_FIXTURE_CITY = '9801'

interface MenuTreeNode {
  id?: string
  type?: string
  meta?: { permission?: string | null }
  children?: MenuTreeNode[]
}

interface MenuTreeResponse {
  fullTree: MenuTreeNode[]
  treeWithoutTypeElement: MenuTreeNode[]
  menuActiveNamesOptions: Array<{ name: string | null, title: string | null }>
}

interface DictTypeRow {
  type: string
  name: string
  dictData: Array<{ label: string, value: string | boolean }>
}

interface AreaRow {
  code: string
  name: string
  pcode: string
}

interface RoleListData {
  data: Array<{ roleName: string }>
  total: number
}

function flattenMenu(nodes: MenuTreeNode[], out: MenuTreeNode[] = []): MenuTreeNode[] {
  for (const node of nodes) {
    out.push(node)
    if (node.children !== undefined && node.children.length > 0) {
      flattenMenu(node.children, out)
    }
  }
  return out
}

describe('真实数据只读 suite：菜单 / 字典 / 国际化 / 区划 / 角色', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null

  async function clearAreaCaches(): Promise<void> {
    await api.cleanupFixedCacheKeys(
      WalnutAdminConstAppCacheKeys.SHARED_AREA_PROVINCE,
      WalnutAdminConstAppCacheKeys.SHARED_AREA_CITY,
    )
  }

  async function cleanupAreaFixture(): Promise<void> {
    if (REAL_MODE) {
      return
    }
    await api.pgDataSource.query('DELETE FROM shared_area WHERE code LIKE $1', [`${AREA_FIXTURE_PROVINCE}%`])
    await clearAreaCaches()
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `real-data-${seed8}`)
    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    if (!REAL_MODE) {
      await clearAreaCaches()
      await cleanupAreaFixture()
      await api.pgDataSource.query(
        `INSERT INTO shared_area (code, name, pcode) VALUES ($1, $2, '0'), ($3, $4, $1)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, pcode = EXCLUDED.pcode`,
        [AREA_FIXTURE_PROVINCE, 'API 规范省', AREA_FIXTURE_CITY, 'API 规范市'],
      )
    }
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await cleanupAreaFixture()
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('菜单树：含 dept/post/employee 的 15 条权限点 element，节点数不低于下界', async () => {
    const res = await api.root('GET', api.apiPath('/system/menu/tree'))
    expectOk(res, 'menu tree')

    const tree = bodyOf<MenuTreeResponse>(res).data
    expect(Array.isArray(tree.fullTree)).toBe(true)

    const nodes = flattenMenu(tree.fullTree)
    expect(nodes.length).toBeGreaterThanOrEqual(MENU_NODE_LOWER_BOUND)

    const permissionNodes = nodes.filter((node) => {
      const permission = node.meta?.permission
      return typeof permission === 'string' && permission !== ''
    })
    const permissionSet = new Set(permissionNodes.map(node => node.meta!.permission!))
    for (const permission of EXPECTED_ORG_PERMISSIONS) {
      expect(permissionSet.has(permission), `missing menu permission: ${permission}`).toBe(true)
    }
    // 权限点都是 element 行（menu.shared.getStrings 只认 permission 列，类型不参与，
    // 但 seed 的语义就是 element；错型说明 seed 落库映射出了问题）
    for (const permission of EXPECTED_ORG_PERMISSIONS) {
      const node = permissionNodes.find(item => item.meta?.permission === permission)
      expect(node?.type).toBe('element')
    }
  })

  it('字典：/system/dict/type/s 返回种子字典集，每项带启用 data', async () => {
    const res = await api.root(
      'GET',
      api.apiPath(`/system/dict/type/s?types=${SEED_DICT_TYPES.join(',')}`),
    )
    expectOk(res, 'dict type s')

    const rows = bodyOf<DictTypeRow[]>(res).data
    expect(rows.map(row => row.type).sort()).toEqual([...SEED_DICT_TYPES].sort())
    for (const row of rows) {
      expect(row.name).toBeTruthy()
      expect(Array.isArray(row.dictData)).toBe(true)
      expect(row.dictData.length).toBeGreaterThan(0)
      // value 列是 text，但 DTO 的 booleanString 转换把 'true'/'false' 回吐成 boolean
      // （WalnutAdminDecoratorTransformerString 的默认 res 行为）
      for (const item of row.dictData) {
        expect(typeof item.label).toBe('string')
        expect(['string', 'boolean']).toContain(typeof item.value)
      }
    }
  })

  it('国际化：message/zh_CN 返回非空 map 且含已知菜单标题键', async () => {
    const res = await api.unsigned('GET', api.apiPath('/system/locale/message/zh_CN?cache=0'))
    expectOk(res, 'locale message zh_CN')

    const messages = bodyOf<Record<string, string>>(res).data
    expect(messages).toBeTypeOf('object')
    expect(Object.keys(messages).length).toBeGreaterThan(100)
    expect(messages['sys.menu.system']).toBeTruthy()
  })

  it.skipIf(REAL_MODE)('区划（seed 模式）：自建两层 fixture 验证 children 层级查询', async () => {
    await clearAreaCaches()

    const topRes = await api.root('GET', api.apiPath('/shared/area/children?pcode=0'))
    expectOk(topRes, 'area children top')
    const top = bodyOf<AreaRow[]>(topRes).data
    const province = top.find(row => row.code === AREA_FIXTURE_PROVINCE)
    expect(province).toBeDefined()
    expect(province?.pcode).toBe('0')

    const childRes = await api.root('GET', api.apiPath(`/shared/area/children?pcode=${AREA_FIXTURE_PROVINCE}`))
    expectOk(childRes, 'area children city')
    const cities = bodyOf<AreaRow[]>(childRes).data
    expect(cities).toHaveLength(1)
    expect(cities[0].code).toBe(AREA_FIXTURE_CITY)
    expect(cities[0].pcode).toBe(AREA_FIXTURE_PROVINCE)
  })

  it.skipIf(!REAL_MODE)('区划（real 模式）：dev 库真实省份 → 首个省份下属市', async () => {
    await clearAreaCaches()

    const topRes = await api.root('GET', api.apiPath('/shared/area/children?pcode=0'))
    expectOk(topRes, 'area children top (real)')
    const provinces = bodyOf<AreaRow[]>(topRes).data
    expect(provinces.length).toBeGreaterThanOrEqual(20)
    expect(provinces.every(row => row.pcode === '0')).toBe(true)

    const first = provinces[0]
    expect(first.code.length).toBe(2)
    const childRes = await api.root('GET', api.apiPath(`/shared/area/children?pcode=${first.code}`))
    expectOk(childRes, 'area children city (real)')
    const cities = bodyOf<AreaRow[]>(childRes).data
    expect(cities.length).toBeGreaterThanOrEqual(1)
    expect(cities.every(row => row.pcode === first.code)).toBe(true)
  })

  it('角色（root 视角）：list 包含 seed 角色，total 不低于 seed 角色数下界', async () => {
    const res = await api.root('POST', api.apiPath('/system/role/list'), {
      query: {},
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 100 },
    })
    expectOk(res, 'role list')

    const list = bodyOf<RoleListData>(res).data
    expect(list.total).toBeGreaterThanOrEqual(SEED_ROLE_NAMES.length)
    const roleNames = new Set(list.data.map(row => row.roleName))
    for (const roleName of SEED_ROLE_NAMES) {
      expect(roleNames.has(roleName), `missing seed role: ${roleName}`).toBe(true)
    }
  })
})

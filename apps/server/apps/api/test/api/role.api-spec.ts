import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Recordable } from 'easy-fns-ts'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstDataScope } from '@walnut-server/const/app/dataScope'
import { SysRoleRepoService } from '@walnut-server/system'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * C 段：`system/role` —— CRUD 四件（无 delete / deleteMany 端点）+ menus 赋值落
 * sys_role_menu junction（create 缺省=空数组、update 未给=junction 不动、给了=整组替换）
 * + root 角色守卫（create 拒 root/developer、update 拒 roleName==='root' 与根角色行）
 * + `findRolesWithPopulatedMenus` 权限链路形态（status 过滤 + menusList 组装）。
 *
 * root 守卫判据（B5 迁移口径）：PG 侧根角色按 role_name 全库唯一判定（'root' 行），
 * create/update 双层拦；本 spec 的 fixture root 角色行正好当「真实根角色」靶子。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RoleRow {
  id: string
  roleName?: string
  description?: string | null
  order?: number | null
  status?: boolean
  dataScope?: number
  menus?: string[]
  deptIds?: string[]
  usersCount?: number
  menusList?: MenuRow[]
}

interface MenuRow {
  id: string
  name?: string | null
  title?: string | null
  meta?: { order?: number | null, status?: boolean }
}

interface RoleListData {
  data: RoleRow[]
  total: number
}

describe('C 段：system/role CRUD 四件 + menus junction + root 守卫（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  /** role_name 全库唯一：本轮行统一前缀 */
  const rolePrefix = `api-spec-role-${seed8}`
  const menuPrefix = `apispec${seed8}`
  /** 批 7 / L6：部门清单上限用例的部门行前缀（dept_code 全库唯一） */
  const deptPrefix = `apispec-dept-${seed8}`
  let fixture: WalnutRootUserFixture | null = null

  const collect = {
    roleIds: [] as string[],
    menuIds: [] as string[],
    /** 经 HTTP 建出的 junction 之外的用户行（usersCount 用例） */
    userIds: [] as string[],
  }

  function rolePayload(tag: string, menus?: string[]) {
    return {
      roleName: `${rolePrefix}-${tag}`,
      description: `role ${tag}`,
      order: 1,
      status: true,
      ...(menus === undefined ? {} : { menus }),
    }
  }

  async function createRole(tag: string, menus?: string[]): Promise<RoleRow> {
    const res = await api.root('POST', api.apiPath('/system/role'), rolePayload(tag, menus))
    expectOk(res, `role create ${tag}`)
    const row = bodyOf<RoleRow>(res).data
    collect.roleIds.push(row.id)
    return row
  }

  async function createMenuViaHttp(tag: string): Promise<MenuRow> {
    const res = await api.root('POST', api.apiPath('/system/menu'), {
      pid: null,
      type: 'menu',
      path: `/${menuPrefix}-${tag}`,
      name: `${menuPrefix}-${tag}`,
      title: `menu.title.${seed8}.${tag}`,
      meta: { order: 1, status: true },
    })
    expectOk(res, `menu create ${tag}`)
    const row = bodyOf<MenuRow>(res).data
    collect.menuIds.push(row.id)
    return row
  }

  /** 批 7 / L6：直插部门行（200 条走 HTTP 太慢；FK 只要求 dept 存在） */
  async function insertBulkDepts(count: number): Promise<string[]> {
    const rows: Array<{ id: string }> = await api.pgDataSource.query(
      `INSERT INTO sys_dept (dept_code, dept_name)
       SELECT $1 || '-bulk-' || g, $2 || ' ' || g
         FROM generate_series(1, $3) AS g
       RETURNING id`,
      [deptPrefix, 'api spec bulk dept', count],
    )
    return rows.map(row => row.id)
  }

  async function insertDept(tag: string): Promise<string> {
    const rows: Array<{ id: string }> = await api.pgDataSource.query(
      'INSERT INTO sys_dept (dept_code, dept_name) VALUES ($1, $2) RETURNING id',
      [`${deptPrefix}-${tag}`, `api spec dept ${tag}`],
    )
    return rows[0].id
  }

  /**
   * 批 7 / L7：role:update 的操作日志由拦截器 fire-and-forget 落库 —— 轮询
   * sys_log_operate 的最新行，断言 before/after 快照（比 HTTP list 更直接；
   * 快照列本就不出现在 list/read 出参里，只能走 snapshot 端点或 DB）。
   */
  async function waitForRoleUpdateSnapshot(roleId: string): Promise<{ before: Recordable, after: Recordable }> {
    const deadline = Date.now() + 8000
    let seen = 0
    while (Date.now() < deadline) {
      const rows: Array<{ snapshot_before: Recordable | null, snapshot_after: Recordable | null }>
        = await api.pgDataSource.query(
          `SELECT snapshot_before, snapshot_after
             FROM sys_log_operate
            WHERE invoking_method = 'SysRoleController.update'
              AND url LIKE $1
            ORDER BY operated_at DESC
            LIMIT 1`,
          [`%${roleId}`],
        )
      seen = rows.length
      const row = rows[0]
      if (row !== undefined && row.snapshot_before !== null && row.snapshot_after !== null) {
        return { before: row.snapshot_before, after: row.snapshot_after }
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`[role-api-spec] role:update log snapshot not found for ${roleId} (rows=${seen})`)
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `role-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterEach(async () => {
    // junction 行随 role/user CASCADE；根角色 fixture 行不在 collect.roleIds，不动
    await api.pgDataSource.query('DELETE FROM sys_user WHERE id = ANY($1::uuid[])', [collect.userIds])
    await api.pgDataSource.query('DELETE FROM sys_role WHERE id = ANY($1::uuid[])', [collect.roleIds])
    await api.pgDataSource.query('DELETE FROM sys_role WHERE role_name LIKE $1', [`${rolePrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_menu WHERE name LIKE $1', [`${menuPrefix}%`])
    // 批 7 / L6：部门行在角色（junction）删除后清，FK 不挡
    await api.pgDataSource.query('DELETE FROM sys_dept WHERE dept_code LIKE $1', [`${deptPrefix}%`])
    collect.roleIds = []
    collect.menuIds = []
    collect.userIds = []
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE role_name LIKE $1', [`${rolePrefix}%`])
      await api.pgDataSource.query('DELETE FROM sys_menu WHERE name LIKE $1', [`${menuPrefix}%`])
      await api.pgDataSource.query('DELETE FROM sys_dept WHERE dept_code LIKE $1', [`${deptPrefix}%`])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('create 缺省 menus → 空数组 + junction 无行；read 回 usersCount=0', async () => {
    const created = await createRole('R1')
    expect(created.id).toMatch(UUID_RE)
    expect(created.menus).toEqual([])

    const readRes = await api.root('GET', api.apiPath(`/system/role/${created.id}`))
    expectOk(readRes, 'role read')
    const row = bodyOf<RoleRow>(readRes).data
    expect(row.roleName).toBe(`${rolePrefix}-R1`)
    expect(row.menus).toEqual([])
    expect(row.usersCount).toBe(0)
  })

  it('create 带 menus → junction 落行；update 未给 menus → junction 不动；给了 → 整组替换', async () => {
    const menuA = await createMenuViaHttp('JA')
    const menuB = await createMenuViaHttp('JB')
    const role = await createRole('J1', [menuA.id, menuB.id])

    let junctionRows: Array<{ menu_id: string }> = await api.pgDataSource.query(
      'SELECT menu_id FROM sys_role_menu WHERE role_id = $1 ORDER BY menu_id',
      [role.id],
    )
    expect(junctionRows.map(r => r.menu_id).sort()).toEqual([menuA.id, menuB.id].sort())

    const readRes = await api.root('GET', api.apiPath(`/system/role/${role.id}`))
    expect(bodyOf<RoleRow>(readRes).data.menus?.sort()).toEqual([menuA.id, menuB.id].sort())

    // 未给 menus：junction 原样保留（Mongo 版逐字段赋值语义）
    const updateKeep = await api.root('PUT', api.apiPath(`/system/role/${role.id}`), {
      roleName: `${rolePrefix}-J1`,
      description: 'desc updated',
      order: 2,
      status: true,
    })
    expectOk(updateKeep, 'role update without menus')
    junctionRows = await api.pgDataSource.query(
      'SELECT menu_id FROM sys_role_menu WHERE role_id = $1',
      [role.id],
    )
    expect(junctionRows).toHaveLength(2)

    // 给了 menus：delete + insert 整组替换
    const updateReplace = await api.root('PUT', api.apiPath(`/system/role/${role.id}`), {
      roleName: `${rolePrefix}-J1`,
      description: 'desc updated',
      order: 2,
      status: true,
      menus: [menuB.id],
    })
    expectOk(updateReplace, 'role update with menus')
    expect(bodyOf<RoleRow>(updateReplace).data.menus).toEqual([menuB.id])

    junctionRows = await api.pgDataSource.query(
      'SELECT menu_id FROM sys_role_menu WHERE role_id = $1',
      [role.id],
    )
    expect(junctionRows.map(r => r.menu_id)).toEqual([menuB.id])
  })

  it('list → roleName 过滤 + usersCount 计数（junction 子查询）+ 出参不带 menus', async () => {
    const role = await createRole('L1')

    // 造一个挂到该角色的用户（junction 行 → 计数 1）
    const userRows: Array<{ id: string }> = await api.pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [`role-spec-user-${seed8}`],
    )
    const userId = userRows[0].id
    collect.userIds.push(userId)
    await api.pgDataSource.query(
      'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2)',
      [userId, role.id],
    )

    const listRes = await api.root('POST', api.apiPath('/system/role/list'), {
      filters: [{ field: 'roleName', op: 'like', value: `${rolePrefix}-L1` }],
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'role list')
    const list = bodyOf<RoleListData>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].usersCount).toBe(1)
    // list 出参类型是 SysRoleDTOSafeWithoutMenus
    expect(list.data[0].menus).toBeUndefined()
  })

  it('root 守卫：create 拒 root/developer；update 拒 roleName=root 与根角色行本身 → 40000', async () => {
    const createRootRes = await api.root('POST', api.apiPath('/system/role'), {
      roleName: 'root',
      description: 'x',
      order: 1,
      status: true,
    })
    expect(bodyOf(createRootRes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const createDeveloper = await api.root('POST', api.apiPath('/system/role'), {
      roleName: 'developer',
      description: 'x',
      order: 1,
      status: true,
    })
    expect(bodyOf(createDeveloper).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    // 改名成 root → 拒
    const role = await createRole('G1')
    const renameToRoot = await api.root('PUT', api.apiPath(`/system/role/${role.id}`), {
      roleName: 'root',
      description: 'x',
      order: 1,
      status: true,
    })
    expect(bodyOf(renameToRoot).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    // 根角色行本身（fixture 的 root junction）→ 按 roleName 全库唯一判据拦
    const updateRootRow = await api.root('PUT', api.apiPath(`/system/role/${fixture!.roleId}`), {
      roleName: `${rolePrefix}-hijack`,
      description: 'x',
      order: 1,
      status: true,
    })
    expect(bodyOf(updateRootRow).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('findRolesWithPopulatedMenus 权限链路形态：status 过滤角色 + menusList 组装 meta', async () => {
    const menuOn = await createMenuViaHttp('PA')
    const menuOff = await createMenuViaHttp('PB')
    // menuOff 停用（match meta.status=true 的 populate 语义 → 不进 menusList）
    await api.root('PUT', api.apiPath(`/system/menu/${menuOff.id}`), {
      name: `${menuPrefix}-PB`,
      title: `menu.title.${seed8}.PB`,
      meta: { order: 1, status: false },
    })

    const roleOn = await createRole('P1', [menuOn.id, menuOff.id])
    const roleOff = await createRole('P2', [menuOn.id])
    await api.root('PUT', api.apiPath(`/system/role/${roleOff.id}`), {
      roleName: `${rolePrefix}-P2`,
      description: 'role P2',
      order: 1,
      status: false,
    })

    const roleRepoService = app.get(SysRoleRepoService)
    const populated = await roleRepoService.findRolesWithPopulatedMenus([roleOn.id, roleOff.id])

    // status=false 的角色整行被滤掉
    expect(populated.map(r => r.id)).toEqual([roleOn.id])
    const row = populated[0]
    expect(row.menus?.sort()).toEqual([menuOn.id, menuOff.id].sort())
    // 只有启用菜单进 menusList，且组装回 meta 对象
    expect(row.menusList).toHaveLength(1)
    expect(row.menusList[0].id).toBe(menuOn.id)
    expect(row.menusList[0].meta?.order).toBe(1)
    expect(row.menusList[0].title).toBe(`menu.title.${seed8}.PA`)
  })

  it('批 7 / L6：deptIds 上限 200 —— 200 个真实部门放行、201 → 40099（整体替换语义不破）', async () => {
    const bulkIds = await insertBulkDepts(200)
    const role = await createRole('D1')

    const update200 = await api.root('PUT', api.apiPath(`/system/role/${role.id}`), {
      ...rolePayload('D1'),
      dataScope: WalnutAdminConstDataScope.CUSTOM,
      deptIds: bulkIds,
    })
    expectOk(update200, 'role update 200 deptIds')
    expect(bodyOf<RoleRow>(update200).data.deptIds).toHaveLength(200)

    // 201 = 200 真实 + 1 随机：DTO 层 arrayMaxSize 拦下（40099），不进入写腿
    const update201 = await api.root('PUT', api.apiPath(`/system/role/${role.id}`), {
      ...rolePayload('D1'),
      dataScope: WalnutAdminConstDataScope.CUSTOM,
      deptIds: [...bulkIds, randomUUID()],
    })
    expect(bodyOf(update201).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    // 被拦的请求没有半提交：清单仍是 200（整组替换只在通过校验后发生）
    const readRes = await api.root('GET', api.apiPath(`/system/role/${role.id}`))
    expectOk(readRes, 'role read after 201 rejected')
    expect(bodyOf<RoleRow>(readRes).data.deptIds).toHaveLength(200)
  })

  it('批 7 / L7：role:update 操作日志快照含 dataScope/status/deptIds/menus 的 before → after', async () => {
    const menuA = await createMenuViaHttp('SA')
    const menuB = await createMenuViaHttp('SB')
    const deptA = await insertDept('sa')
    const deptB = await insertDept('sb')

    const createRes = await api.root('POST', api.apiPath('/system/role'), {
      roleName: `${rolePrefix}-A1`,
      description: 'audit before',
      order: 1,
      status: true,
      dataScope: WalnutAdminConstDataScope.CUSTOM,
      deptIds: [deptA],
      menus: [menuA.id],
    })
    expectOk(createRes, 'role create (audit producer)')
    const role = bodyOf<RoleRow>(createRes).data
    collect.roleIds.push(role.id)

    const updateRes = await api.root('PUT', api.apiPath(`/system/role/${role.id}`), {
      roleName: `${rolePrefix}-A1`,
      description: 'audit after',
      order: 2,
      status: false,
      dataScope: WalnutAdminConstDataScope.DEPT,
      deptIds: [deptB],
      menus: [menuB.id],
    })
    expectOk(updateRes, 'role update (audit producer)')

    const { before, after } = await waitForRoleUpdateSnapshot(role.id)

    // 四个授权敏感面：before 是提交前的值与清单，after 是提交后的值与清单
    expect(before).toMatchObject({
      dataScope: WalnutAdminConstDataScope.CUSTOM,
      status: true,
      deptIds: [deptA],
      menus: [menuA.id],
    })
    expect(after).toMatchObject({
      dataScope: WalnutAdminConstDataScope.DEPT,
      status: false,
      deptIds: [deptB],
      menus: [menuB.id],
    })
    // 行字段的既有审计面仍在（合并而非覆盖基类快照）
    expect(before.roleName).toBe(`${rolePrefix}-A1`)
    expect(after.description).toBe('audit after')
  })

  it('read 不存在的 uuid → 40401；create 缺 roleName → 40099', async () => {
    const readRes = await api.root('GET', api.apiPath(`/system/role/${randomUUID()}`))
    expect(bodyOf(readRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const missingName = await api.root('POST', api.apiPath('/system/role'), {
      description: 'x',
      order: 1,
      status: true,
    })
    expect(bodyOf(missingName).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

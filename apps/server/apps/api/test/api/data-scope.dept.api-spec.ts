import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import type { SeedPermissionChainFixture } from './helpers/seed-permissions'
import { randomUUID } from 'node:crypto'
import { ThrottlerStorage } from '@nestjs/throttler'
import { WalnutAdminConstDataScope } from '@walnut-server/const/app/dataScope'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { cleanupPermissionChainSeed, seedPermissionChainUser } from './helpers/seed-permissions'

/**
 * 数据权限二期批 1 —— **部门维度端到端**（真实 HTTP 全链，靶表 `sys_employee`）。
 *
 * 批 1 不给 app_demo 加 dept 列（批 2 的事），部门系档位的端到端验证落在已有
 * `sys_employee.dept_id` 上：不同 data_scope 的用户列出不同部门的职工行。
 *
 * 覆盖：
 * - DEPT（本部门）/ DEPT_AND_CHILD（递归子树）/ CUSTOM（sys_role_dept 清单）/
 *   DEPT_OR_SELF（子树 ∪ 本人绑定行）/ SELF（仅绑定行）/ 无部门 DEPT（空集）；
 * - 越权 read/update 一律 404（不泄露行存在性）；
 * - 用户 dept 变更（user update 的 deptId）后的缓存失效；
 * - 部门移动（parentId 变更）后的缓存失效 —— 旧/新祖先链用户的 DEPT_AND_CHILD 重算。
 *
 * 员工分布（deptA / deptA-child / deptB）：
 *   empA1, empA2 → deptA；empChild1 → deptA-child；
 *   empB1, empOrSelf（绑 orSelf）, empSolo（绑 solo）→ deptB。
 */

const EMPLOYEE_PERMISSIONS = [
  'system:employee:list',
  'system:employee:read',
  'system:employee:update',
]

interface EmployeeRow {
  id: string
  employeeNo: string
  deptId: string
  userId?: string | null
}

interface EmployeeListData {
  data: EmployeeRow[]
  total: number
}

interface DeptRow {
  id: string
  parentId: string | null
  deptCode: string
  deptName: string
  leader: string | null
  phone: string | null
  email: string | null
  sortOrder: number
  status: string
}

describe('数据权限二期：部门维度（DEPT / DEPT_AND_CHILD / CUSTOM / DEPT_OR_SELF / SELF）', () => {
  let app: NestExpressApplication
  let rootApi: WalnutApiClient

  const seed = randomUUID()
  const seed8 = seed.slice(0, 8).toUpperCase()
  const deptPrefix = `API-DSD-${seed8}`
  const employeePrefix = `api-dsd-emp-${seed8}`

  const clients: WalnutApiClient[] = []

  let rootFixture: WalnutRootUserFixture

  let deptA = ''
  let deptChild = ''
  let deptB = ''

  let empA1 = ''
  let empA2 = ''
  let empChild1 = ''
  let empB1 = ''
  let empOrSelf = ''
  let empSolo = ''

  interface UserFixture {
    client: WalnutApiClient
    fixture: SeedPermissionChainFixture
  }

  let userDeptA: UserFixture
  let userDeptChild: UserFixture
  let userDeptChildManager: UserFixture
  let userDeptB: UserFixture
  let userDeptBManager: UserFixture
  let userCustom: UserFixture
  let userOrSelf: UserFixture
  let userSolo: UserFixture
  let userNoDept: UserFixture

  const allFixtures = () => [
    userDeptA,
    userDeptChild,
    userDeptChildManager,
    userDeptB,
    userDeptBManager,
    userCustom,
    userOrSelf,
    userSolo,
    userNoDept,
  ].filter(item => item !== undefined)

  async function createClient(): Promise<WalnutApiClient> {
    // device/initial 上限 4 次/60s（按 IP）；本 spec 需要 9 个独立设备（每用户一个，
    // auth 链禁止同设备重复登录）。ThrottlerStorageService 是 app 实例内的内存 Map
    // （按 app 隔离，不会波及其他 spec）—— 引导前清空计数（storage + 每键命中时间线
    // hitExpirations 都要清；只清 storage 时 prune 会把旧 hits 回填）。限流行为由
    // throttle 专项覆盖。
    const storage = app.get<{
      storage: Map<string, unknown>
      hitExpirations: Map<string, unknown>
    }>(ThrottlerStorage)
    storage.storage.clear()
    storage.hitExpirations.clear()

    const client = await WalnutApiClient.create(app)
    clients.push(client)
    return client
  }

  async function loginAs(client: WalnutApiClient, fixture: { userId: string, userName: string, password: string }) {
    const tokens = await performHttpOpaqueLogin(client, app, fixture)
    client.setAuth(tokens)
    await client.seedMfaVerifiedCache(fixture.userId)
    expectOk(await client.root('GET', client.apiPath('/auth/permissions')), `prime permissions ${fixture.userName}`)
  }

  async function createDept(tag: string, parentId: string | null): Promise<DeptRow> {
    const res = await rootApi.root('POST', rootApi.apiPath('/system/dept'), {
      parentId,
      deptCode: `${deptPrefix}-${tag}`,
      deptName: `数据权限部门 ${tag}`,
      status: 'enabled',
      sortOrder: 1,
    })
    expectOk(res, `dept create ${tag}`)
    return bodyOf<DeptRow>(res).data
  }

  function employeePayload(tag: string, deptId: string) {
    return {
      employeeNo: `${employeePrefix}-${tag}`,
      employeeName: `职工 ${tag}`,
      deptId,
      entryDate: '2026-01-01T00:00:00.000Z',
      status: 'active',
    }
  }

  async function createEmployee(tag: string, deptId: string): Promise<string> {
    const res = await rootApi.root('POST', rootApi.apiPath('/system/employee'), employeePayload(tag, deptId))
    expectOk(res, `employee create ${tag}`)
    return bodyOf<EmployeeRow>(res).data.id
  }

  async function bindEmployee(employeeId: string, userId: string) {
    const res = await rootApi.root('POST', rootApi.apiPath(`/system/employee/${employeeId}/bind-user`), { userId })
    expectOk(res, 'employee bind user')
  }

  async function listEmployees(client: WalnutApiClient, pageSize = 50): Promise<EmployeeListData> {
    const res = await client.root('POST', client.apiPath('/system/employee/list'), {
      query: { employeeNo: employeePrefix },
      page: { page: 1, pageSize },
    })
    expectOk(res, 'employee list')
    return bodyOf<EmployeeListData>(res).data
  }

  async function seedUser(
    prefix: string,
    dataScope: number,
    deptId: string | null,
  ): Promise<UserFixture> {
    const client = await createClient()
    const fixture = await seedPermissionChainUser(app, rootApi.pgDataSource, {
      userNamePrefix: prefix,
      grantedPermissions: EMPLOYEE_PERMISSIONS,
      dataScope,
      deptId,
    })
    return { client, fixture }
  }

  async function updateUserDept(user: UserFixture, deptId: string | null) {
    const res = await rootApi.root('PUT', rootApi.apiPath(`/system/user/${user.fixture.userId}`), {
      userName: user.fixture.userName,
      status: true,
      roles: [user.fixture.mainRoleId],
      deptId,
    })
    expectOk(res, 'update user dept')

    // update DTO 的 roles 必填，写路径会同时清掉权限缓存（P1-18）——重新拉一次
    expectOk(await user.client.root('GET', user.client.apiPath('/auth/permissions')), 'prime permissions after dept update')
  }

  beforeAll(async () => {
    app = await createApiApp()

    rootApi = await createClient()
    rootFixture = await registerRootUserFixture(app, rootApi.pgDataSource, `dsd-root-${seed8}`)
    await loginAs(rootApi, rootFixture)

    deptA = (await createDept('a', null)).id
    deptChild = (await createDept('a-child', deptA)).id
    deptB = (await createDept('b', null)).id

    empA1 = await createEmployee('a1', deptA)
    empA2 = await createEmployee('a2', deptA)
    empChild1 = await createEmployee('child1', deptChild)
    empB1 = await createEmployee('b1', deptB)
    empOrSelf = await createEmployee('or-self', deptB)
    empSolo = await createEmployee('solo', deptB)

    userDeptA = await seedUser('dsd-a', WalnutAdminConstDataScope.DEPT, deptA)
    userDeptChild = await seedUser('dsd-child', WalnutAdminConstDataScope.DEPT, deptChild)
    userDeptChildManager = await seedUser('dsd-child-mgr', WalnutAdminConstDataScope.DEPT_AND_CHILD, deptA)
    userDeptB = await seedUser('dsd-b', WalnutAdminConstDataScope.DEPT, deptB)
    userDeptBManager = await seedUser('dsd-b-mgr', WalnutAdminConstDataScope.DEPT_AND_CHILD, deptB)
    userCustom = await seedUser('dsd-custom', WalnutAdminConstDataScope.CUSTOM, deptB)
    userOrSelf = await seedUser('dsd-or-self', WalnutAdminConstDataScope.DEPT_OR_SELF, deptA)
    userSolo = await seedUser('dsd-solo', WalnutAdminConstDataScope.SELF, deptA)
    userNoDept = await seedUser('dsd-no-dept', WalnutAdminConstDataScope.DEPT, null)

    // CUSTOM 部门清单：deptA + deptB（不含 deptA-child）。必须在**登录前**写好 ——
    // 登录后的第一个已认证请求就会解析并缓存 AUTH:DATA_SCOPE（这里没有 HTTP 写入口
    // 能触发失效）。
    await rootApi.pgDataSource.query(
      'INSERT INTO sys_role_dept (role_id, dept_id) VALUES ($1, $2), ($1, $3)',
      [userCustom.fixture.mainRoleId, deptA, deptB],
    )

    // 本人腿：orSelf 在 deptB 的职工行、solo 的绑定行（跨部门，证明 SELF 腿独立于部门）
    await bindEmployee(empOrSelf, userOrSelf.fixture.userId)
    await bindEmployee(empSolo, userSolo.fixture.userId)

    // 全部 fixture 就绪后再登录（每个用户一个独立设备）
    for (const user of allFixtures()) {
      await loginAs(user.client, user.fixture)
    }
  })

  afterAll(async () => {
    if (rootApi !== undefined) {
      await rootApi.pgDataSource.query('DELETE FROM sys_employee WHERE employee_no LIKE $1', [`${employeePrefix}%`])

      await cleanupPermissionChainSeed(
        rootApi,
        allFixtures().map(item => item.fixture),
        clients.map(client => client.deviceId),
      )

      // 部门树自底向上删（FK self RESTRICT）
      await rootApi.pgDataSource.query('DELETE FROM sys_dept WHERE id = $1', [deptChild])
      await rootApi.pgDataSource.query('DELETE FROM sys_dept WHERE id = ANY($1::uuid[])', [[deptA, deptB]])

      if (rootFixture !== undefined) {
        await rootApi.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [rootFixture.userId])
        await rootApi.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [rootFixture.roleId])
        await rootApi.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [clients.map(client => client.deviceId)])
        await rootApi.cleanupWalnutCacheKeys(
          seed8,
          ...clients.map(client => client.deviceId),
          rootFixture.userId,
          ...allFixtures().map(item => item.fixture.userId),
        )
      }
    }

    await app.close()
  })

  it('root（ALL）看到全部职工行', async () => {
    const list = await listEmployees(rootApi)

    expect(new Set(list.data.map(row => row.id)))
      .toEqual(new Set([empA1, empA2, empChild1, empB1, empOrSelf, empSolo]))
    expect(list.total).toBe(6)
  })

  it('DEPT：只见本部门（deptA 两行，child / deptB 不可见）', async () => {
    const list = await listEmployees(userDeptA.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([empA1, empA2]))
    expect(list.total).toBe(2)
  })

  it('DEPT_AND_CHILD：本部门及以下（deptA + deptA-child）', async () => {
    const list = await listEmployees(userDeptChildManager.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([empA1, empA2, empChild1]))
    expect(list.total).toBe(3)
  })

  it('DEPT：deptA-child 只看到 child 行', async () => {
    const list = await listEmployees(userDeptChild.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([empChild1]))
    expect(list.total).toBe(1)
  })

  it('DEPT：deptB 看到 deptB 三行（含绑定到其他用户的职工）', async () => {
    const list = await listEmployees(userDeptB.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([empB1, empOrSelf, empSolo]))
    expect(list.total).toBe(3)
  })

  it('CUSTOM：sys_role_dept 清单（deptA ∪ deptB，不递归 child）', async () => {
    const list = await listEmployees(userCustom.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([empA1, empA2, empB1, empOrSelf, empSolo]))
    expect(list.total).toBe(5)
  })

  it('DEPT_OR_SELF：deptA 子树 ∪ 本人绑定行（empOrSelf 在 deptB）', async () => {
    const list = await listEmployees(userOrSelf.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([empA1, empA2, empChild1, empOrSelf]))
    expect(list.total).toBe(4)
  })

  it('SELF：只看到本人绑定行（empSolo，即使它在 deptB）', async () => {
    const list = await listEmployees(userSolo.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([empSolo]))
    expect(list.total).toBe(1)
  })

  it('DEPT + 用户无部门：空集（默认拒绝）', async () => {
    const list = await listEmployees(userNoDept.client)

    expect(list.data).toEqual([])
    expect(list.total).toBe(0)
  })

  it('越权 read/update 一律 404；本部门行可读可改', async () => {
    const readChild = await userDeptA.client.root('GET', userDeptA.client.apiPath(`/system/employee/${empChild1}`))
    expect(bodyOf(readChild).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const updateB = await userDeptA.client.root('PUT', userDeptA.client.apiPath(`/system/employee/${empB1}`), employeePayload('b1', deptB))
    expect(bodyOf(updateB).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const readOwn = await userDeptA.client.root('GET', userDeptA.client.apiPath(`/system/employee/${empA1}`))
    expectOk(readOwn, 'DEPT user read own dept row')

    const updateOwn = await userDeptA.client.root('PUT', userDeptA.client.apiPath(`/system/employee/${empA1}`), employeePayload('a1', deptA))
    expectOk(updateOwn, 'DEPT user update own dept row')
  })

  it('用户 dept 变更后缓存失效：下一请求按新部门过滤', async () => {
    // 先填充 AUTH:DATA_SCOPE（deptA）
    expect((await listEmployees(userDeptA.client)).total).toBe(2)

    await updateUserDept(userDeptA, deptB)

    const afterMove = await listEmployees(userDeptA.client)
    expect(new Set(afterMove.data.map(row => row.id))).toEqual(new Set([empB1, empOrSelf, empSolo]))

    // 复原，避免影响后续部门移动用例的预期
    await updateUserDept(userDeptA, deptA)
    expect((await listEmployees(userDeptA.client)).total).toBe(2)
  })

  it('部门移动后缓存失效：旧/新祖先链的 DEPT_AND_CHILD 立即按新子树过滤', async () => {
    // 旧状态：deptA 总监看 A+child（3）；deptB 总监看 B（3）
    expect((await listEmployees(userDeptChildManager.client)).total).toBe(3)
    expect((await listEmployees(userDeptBManager.client)).total).toBe(3)

    // 把 deptA-child 移到 deptB 下（PUT 整体替换，先读当前值）
    const readDept = await rootApi.root('GET', rootApi.apiPath(`/system/dept/${deptChild}`))
    expectOk(readDept, 'read dept child')
    const current = bodyOf<DeptRow>(readDept).data

    const moveRes = await rootApi.root('PUT', rootApi.apiPath(`/system/dept/${deptChild}`), {
      parentId: deptB,
      deptCode: current.deptCode,
      deptName: current.deptName,
      leader: current.leader ?? null,
      phone: current.phone ?? null,
      email: current.email ?? null,
      sortOrder: current.sortOrder,
      status: current.status,
    })
    expectOk(moveRes, 'move dept child under deptB')

    // deptA 总监（DEPT_AND_CHILD deptA）失去 child 子树；deptB 经理获得 child
    const aAfter = await listEmployees(userDeptChildManager.client)
    expect(new Set(aAfter.data.map(row => row.id))).toEqual(new Set([empA1, empA2]))

    const bAfter = await listEmployees(userDeptBManager.client)
    expect(new Set(bAfter.data.map(row => row.id))).toEqual(new Set([empB1, empOrSelf, empSolo, empChild1]))

    // child 自己的经理（DEPT deptA-child）不受影响
    const childAfter = await listEmployees(userDeptChild.client)
    expect(new Set(childAfter.data.map(row => row.id))).toEqual(new Set([empChild1]))
  })
})

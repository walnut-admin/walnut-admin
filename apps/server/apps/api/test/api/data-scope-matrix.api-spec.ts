import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import type { SeedPermissionChainFixture } from './helpers/seed-permissions'
import { randomUUID } from 'node:crypto'
import { ThrottlerStorage } from '@nestjs/throttler'
import { WalnutAdminConstDataScope } from '@walnut-server/const/app/dataScope'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { Role } from '@walnut/contract'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { attemptHttpOpaqueLogin, performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { cleanupPermissionChainSeed, seedPermissionChainUser } from './helpers/seed-permissions'

/**
 * 数据权限二期批 2 —— **demo 表 M1-M10 端到端矩阵**（真实 HTTP 全链）。
 *
 * 真源：`docs/plans/data-scope-phase2-3-plan.md` §0（终态用户/行分布）与 §1.2
 * （M1-M10 断言矩阵）。靶表 `app_demo`：二期批 2 给它加了 `dept_id`（方案 A 冗余列），
 * create 自动回填「创建者的 sys_employee.dept_id」（无职工行 → NULL）。
 *
 * fixture 结构（每用户独立设备 —— auth 链禁止同设备重复登录 40109）：
 * - 部门：deptA（根）/ deptA-child（deptA 子）/ deptB（根）
 * - 用户与档位：root(ALL) / deptA-all(ALL) / deptA-manager(DEPT, deptA) /
 *   deptA-staff(DEPT, deptA) / child-manager(DEPT_AND_CHILD, deptA) /
 *   child-staff(DEPT, deptA-child) / deptB-manager(DEPT, deptB) /
 *   custom(CUSTOM: deptA+deptB, deptA) / combo(DEPT deptB + SELF, COMBINE) /
 *   solo(SELF, 无职工行) / visitor(SWITCH, currentRole=visitor) / no-role(无任何角色)
 *
 * demo 行分布（10 行，demoString 共同前缀隔离）：
 *   root×1（dept NULL）/ deptA-manager×2 / deptA-staff×1（以上三行 deptA）/
 *   child-staff×1（deptA-child）/ deptB-manager×1（deptB）/
 *   solo×1（NULL）/ combo×1（创建后 SQL 移到 NULL —— 证明 DEPT+SELF 并集的本人腿）/
 *   visitor×1（root 创建后改 owner，NULL）/ 无主×1（owner 与 dept 都 NULL）
 *
 * M9 的一个事实边界：**无角色用户登录即被拒（40103）** —— `checkUserAndRoleStatus`
 * 对空 roles_list 抛「禁止登录」（40104），opaque 服务的 catch 把登录链内的失败统一
 * 翻译成 40103（Invalid Credentials，不泄露账号状态）。所以「无角色 → 空列表」在
 * HTTP 层不可能走到数据查询；这里断言登录被拒（比空列表更早的默认拒绝）。数据面
 * 「空清单 → 空」的默认拒绝由 M10 的 CUSTOM 空部门清单一步覆盖（同一 resolver deny 语义）。
 */

const DEMO_PERMISSIONS = [
  'app:demo:create',
  'app:demo:read',
  'app:demo:update',
  'app:demo:delete',
  'app:demo:list',
]

interface DemoRow {
  id: string
  demoString?: string
}

interface DemoListData {
  data: DemoRow[]
  total: number
}

interface RoleReadData {
  id: string
  roleName: string
  description: string | null
  order: number | null
  status: boolean
  dataScope: number
  deptIds: string[]
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

interface EmployeeRow {
  id: string
}

interface UserFixture {
  client: WalnutApiClient
  fixture: SeedPermissionChainFixture
}

function demoPayload(demoString: string) {
  return {
    demoString,
    demoPhoneNumber: `139${randomUUID().replaceAll('-', '').slice(0, 8)}`,
    demoNumber: 1,
    demoBoolean: true,
    demoDate: '2026-01-01T00:00:00.000Z',
    demoEnum: 1,
    demoMongoId: randomUUID(),
    demoObject: { o1: 'DSM-OBJ', o2: 2, o3: false },
    demoStringArray: ['1', 'a'],
    demoNumberArray: [-1, 2],
    demoBooleanArray: [true],
    demoDateArray: ['2026-01-01T00:00:00.000Z'],
    demoEnumArray: [1, 2],
    demoMongoIdArray: [randomUUID()],
  }
}

describe('数据权限二期批 2：app_demo M1-M10 矩阵（六档 / 越权 404 / 回填 / 缓存失效）', () => {
  let app: NestExpressApplication
  let rootApi: WalnutApiClient

  const seed = randomUUID()
  const seed8 = seed.slice(0, 8).toUpperCase()
  const group = `API-DSM-${seed8}`
  const deptPrefix = `API-DSM-DEPT-${seed8}`
  const employeePrefix = `api-dsm-emp-${seed8}`

  const clients: WalnutApiClient[] = []
  let rootFixture: WalnutRootUserFixture

  let deptA = ''
  let deptChild = ''
  let deptB = ''

  let deptAAll: UserFixture
  let deptAManager: UserFixture
  let deptAStaff: UserFixture
  let childManager: UserFixture
  let childStaff: UserFixture
  let deptBManager: UserFixture
  let custom: UserFixture
  let combo: UserFixture
  let solo: UserFixture
  let visitor: UserFixture
  let noRole: UserFixture

  let createdVisitorRoleId: string | null = null

  let rootRow = ''
  let deptA1 = ''
  let deptA2 = ''
  let deptA3 = ''
  let childRow = ''
  let deptB1 = ''
  let soloRow = ''
  let comboRow = ''
  let visitorRow = ''
  let ownerlessRow = ''

  const createdIds: string[] = []

  const allFixtures = () => [
    deptAAll,
    deptAManager,
    deptAStaff,
    childManager,
    childStaff,
    deptBManager,
    custom,
    combo,
    solo,
    visitor,
    noRole,
  ].filter(item => item !== undefined)

  function allRows(): string[] {
    return [rootRow, deptA1, deptA2, deptA3, childRow, deptB1, soloRow, comboRow, visitorRow, ownerlessRow]
      .filter(id => id !== '')
  }

  async function createClient(): Promise<WalnutApiClient> {
    // device/initial 上限 4 次/60s（按 IP）；本 spec 需要 12 个独立设备。
    // ThrottlerStorage 是 app 实例内的内存 Map（按 app 隔离）—— 引导前清空计数
    // （storage + hitExpirations，手法同 data-scope.dept.api-spec）。
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
    // 非 root 的权限串必须经一次 /auth/permissions 写入 AUTH:PERMISSIONS
    expectOk(await client.root('GET', client.apiPath('/auth/permissions')), `prime permissions ${fixture.userName}`)
  }

  async function seedUser(
    prefix: string,
    dataScope: number,
    deptId: string | null = null,
    options: { roleMode?: typeof WalnutAdminConstRoleMode[keyof typeof WalnutAdminConstRoleMode], secondRolePermissions?: string[] } = {},
  ): Promise<UserFixture> {
    const client = await createClient()
    const fixture = await seedPermissionChainUser(app, rootApi.pgDataSource, {
      userNamePrefix: prefix,
      grantedPermissions: DEMO_PERMISSIONS,
      dataScope,
      deptId,
      roleMode: options.roleMode,
      secondRolePermissions: options.secondRolePermissions,
    })
    return { client, fixture }
  }

  async function createDept(tag: string, parentId: string | null): Promise<DeptRow> {
    const res = await rootApi.root('POST', rootApi.apiPath('/system/dept'), {
      parentId,
      deptCode: `${deptPrefix}-${tag}`,
      deptName: `数据权限矩阵部门 ${tag}`,
      status: 'enabled',
      sortOrder: 1,
    })
    expectOk(res, `dept create ${tag}`)
    return bodyOf<DeptRow>(res).data
  }

  async function createEmployee(tag: string, deptId: string): Promise<string> {
    const res = await rootApi.root('POST', rootApi.apiPath('/system/employee'), {
      employeeNo: `${employeePrefix}-${tag}`,
      employeeName: `矩阵职工 ${tag}`,
      deptId,
      entryDate: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
    expectOk(res, `employee create ${tag}`)
    return bodyOf<EmployeeRow>(res).data.id
  }

  async function bindEmployee(employeeId: string, userId: string) {
    const res = await rootApi.root('POST', rootApi.apiPath(`/system/employee/${employeeId}/bind-user`), { userId })
    expectOk(res, 'employee bind user')
  }

  /** 给某个 fixture 配职工（dept 归属的 create 回填输入）并绑定账号 */
  async function attachEmployee(user: UserFixture, tag: string, deptId: string) {
    const employeeId = await createEmployee(tag, deptId)
    await bindEmployee(employeeId, user.fixture.userId)
  }

  async function createDemo(client: WalnutApiClient, tag: string): Promise<string> {
    const res = await client.root('POST', client.apiPath('/app/demo'), demoPayload(`${group}-${tag}`))
    expectOk(res, `demo create ${tag}`)
    const id = bodyOf<DemoRow>(res).data.id
    createdIds.push(id)
    return id
  }

  async function listDemo(client: WalnutApiClient, pageSize = 50): Promise<DemoListData> {
    const res = await client.root('POST', client.apiPath('/app/demo/list'), {
      query: { demoString: group },
      page: { page: 1, pageSize },
    })
    expectOk(res, 'demo list')
    return bodyOf<DemoListData>(res).data
  }

  async function readRole(roleId: string): Promise<RoleReadData> {
    const res = await rootApi.root('GET', rootApi.apiPath(`/system/role/${roleId}`))
    expectOk(res, 'role read')
    return bodyOf<RoleReadData>(res).data
  }

  /** role update 的 PUT 是整体替换：必填核回填当前值，只改 dataScope / deptIds */
  async function updateRoleScope(roleId: string, payload: { dataScope: number, deptIds?: string[] }) {
    const role = await readRole(roleId)
    const res = await rootApi.root('PUT', rootApi.apiPath(`/system/role/${roleId}`), {
      roleName: role.roleName,
      description: role.description ?? '',
      order: role.order ?? 0,
      status: role.status,
      dataScope: payload.dataScope,
      ...(payload.deptIds === undefined ? {} : { deptIds: payload.deptIds }),
    })
    expectOk(res, `role update dataScope=${payload.dataScope}`)
    return bodyOf<RoleReadData>(res).data
  }

  async function updateDemoOwn(client: WalnutApiClient, id: string, tag: string) {
    return client.root('PUT', client.apiPath(`/app/demo/${id}`), demoPayload(`${group}-${tag}`))
  }

  function expectNotFound(res: SuperTestResponse, what: string) {
    expect(bodyOf(res).code, what).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  }

  beforeAll(async () => {
    app = await createApiApp()

    rootApi = await createClient()
    rootFixture = await registerRootUserFixture(app, rootApi.pgDataSource, `dsm-root-${seed8}`)
    await loginAs(rootApi, rootFixture)

    // ── 部门树（deptA / deptA-child / deptB）───────────────────────────────
    deptA = (await createDept('a', null)).id
    deptChild = (await createDept('a-child', deptA)).id
    deptB = (await createDept('b', null)).id

    // ── 用户 fixture（登录前把员工/角色清单都备好）────────────────────────
    deptAAll = await seedUser('dsm-a-all', WalnutAdminConstDataScope.ALL, deptA)
    deptAManager = await seedUser('dsm-a-mgr', WalnutAdminConstDataScope.DEPT, deptA)
    deptAStaff = await seedUser('dsm-a-staff', WalnutAdminConstDataScope.DEPT, deptA)
    childManager = await seedUser('dsm-child-mgr', WalnutAdminConstDataScope.DEPT_AND_CHILD, deptA)
    childStaff = await seedUser('dsm-child-staff', WalnutAdminConstDataScope.DEPT, deptChild)
    deptBManager = await seedUser('dsm-b-mgr', WalnutAdminConstDataScope.DEPT, deptB)
    custom = await seedUser('dsm-custom', WalnutAdminConstDataScope.CUSTOM, deptA)
    // combo：主角色 DEPT(deptB) + 第二角色 SELF（seed 只给第二角色建行，档位直写 SELF）
    combo = await seedUser('dsm-combo', WalnutAdminConstDataScope.DEPT, deptB, {
      secondRolePermissions: ['app:demo:read'],
    })
    await rootApi.pgDataSource.query(
      'UPDATE sys_role SET data_scope = $2 WHERE id = $1',
      [combo.fixture.secondRoleId, WalnutAdminConstDataScope.SELF],
    )
    solo = await seedUser('dsm-solo', WalnutAdminConstDataScope.SELF, null)
    noRole = await seedUser('dsm-no-role', WalnutAdminConstDataScope.SELF, null)

    // visitor：roleMode SWITCH + currentRole 指向全局 role_name=visitor 的角色
    // （permission.guard 的 visitor 特例只认 SWITCH + currentRoleName === 'visitor'）
    visitor = await seedUser('dsm-visitor', WalnutAdminConstDataScope.SELF, null, {
      roleMode: WalnutAdminConstRoleMode.SWITCH,
    })

    const existingVisitorRole: Array<{ id: string }> = await rootApi.pgDataSource.query(
      'SELECT id FROM sys_role WHERE role_name = $1',
      [Role.VISITOR],
    )
    let visitorRoleId = existingVisitorRole[0]?.id ?? null
    if (visitorRoleId === null) {
      const inserted: Array<{ id: string }> = await rootApi.pgDataSource.query(
        'INSERT INTO sys_role (role_name) VALUES ($1) RETURNING id',
        [Role.VISITOR],
      )
      visitorRoleId = inserted[0].id
      createdVisitorRoleId = visitorRoleId
    }
    await rootApi.pgDataSource.query(
      'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [visitor.fixture.userId, visitorRoleId],
    )
    await rootApi.pgDataSource.query(
      'UPDATE sys_user SET current_role_id = $2, role_mode = $3 WHERE id = $1',
      [visitor.fixture.userId, visitorRoleId, WalnutAdminConstRoleMode.SWITCH],
    )

    // 无角色用户：登录闸对空 roles_list 直接 40104（M9 的语义落点），先清 junction
    await rootApi.pgDataSource.query('DELETE FROM sys_user_role WHERE user_id = $1', [noRole.fixture.userId])

    // ── 职工行（create 回填 dept 的输入）──────────────────────────────────
    await attachEmployee(deptAAll, 'a-all', deptA)
    await attachEmployee(deptAManager, 'a-mgr', deptA)
    await attachEmployee(deptAStaff, 'a-staff', deptA)
    await attachEmployee(childManager, 'child-mgr', deptA)
    await attachEmployee(childStaff, 'child-staff', deptChild)
    await attachEmployee(deptBManager, 'b-mgr', deptB)
    await attachEmployee(custom, 'custom', deptA)
    await attachEmployee(combo, 'combo', deptB)
    // solo / visitor / no-role 刻意没有职工行：create 回填 dept = NULL

    // CUSTOM 部门清单：deptA + deptB（不含 deptA-child）。必须在登录前写好 ——
    // 首个已认证请求就会解析并缓存 AUTH:DATA_SCOPE；这里也顺带固定 M6 的读回形态。
    await rootApi.pgDataSource.query(
      'INSERT INTO sys_role_dept (role_id, dept_id) VALUES ($1, $2), ($1, $3)',
      [custom.fixture.mainRoleId, deptA, deptB],
    )

    // ── 登录（deptAAll 起每个用户独立设备；noRole 走登录被拒断言，不在此登录）──
    for (const user of allFixtures().filter(item => item !== noRole)) {
      await loginAs(user.client, user.fixture)
    }

    // ── demo 行分布 ───────────────────────────────────────────────────────
    rootRow = await createDemo(rootApi, 'ROOT')
    deptA1 = await createDemo(deptAManager.client, 'A1')
    deptA2 = await createDemo(deptAManager.client, 'A2')
    deptA3 = await createDemo(deptAStaff.client, 'A3')
    childRow = await createDemo(childStaff.client, 'CHILD')
    deptB1 = await createDemo(deptBManager.client, 'B1')
    soloRow = await createDemo(solo.client, 'SOLO')
    comboRow = await createDemo(combo.client, 'COMBO')
    visitorRow = await createDemo(rootApi, 'VISITOR')
    ownerlessRow = await createDemo(rootApi, 'OWNERLESS')

    // combo 的行挪到「无部门」——SELF 腿与 DEPT 腿的并集才能被单独观察
    await rootApi.pgDataSource.query('UPDATE app_demo SET dept_id = NULL WHERE id = $1', [comboRow])
    // visitor 的行改 owner（visitor 无 :create 权限；fixture 直改 owner 是唯一通道）
    await rootApi.pgDataSource.query('UPDATE app_demo SET created_by = $1, dept_id = NULL WHERE id = $2', [visitor.fixture.userId, visitorRow])
    // 无主行：owner 与 dept 都 NULL（仅 ALL 可见）
    await rootApi.pgDataSource.query('UPDATE app_demo SET created_by = NULL, dept_id = NULL WHERE id = $1', [ownerlessRow])
  })

  afterAll(async () => {
    if (rootApi !== undefined) {
      if (createdIds.length > 0) {
        await rootApi.pgDataSource.query('DELETE FROM app_demo WHERE id = ANY($1::uuid[])', [createdIds])
        await rootApi.pgDataSource.query('DELETE FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])', [createdIds])
      }

      // 职工先于部门（dept FK RESTRICT）；demo 行也先于部门（上面已删）
      await rootApi.pgDataSource.query('DELETE FROM sys_employee WHERE employee_no LIKE $1', [`${employeePrefix}%`])

      await cleanupPermissionChainSeed(
        rootApi,
        allFixtures().map(item => item.fixture),
        clients.map(client => client.deviceId),
      )

      // 部门树自底向上删（FK self RESTRICT）
      await rootApi.pgDataSource.query('DELETE FROM sys_dept WHERE id = $1', [deptChild])
      await rootApi.pgDataSource.query('DELETE FROM sys_dept WHERE id = ANY($1::uuid[])', [[deptA, deptB]])

      if (createdVisitorRoleId !== null) {
        await rootApi.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [createdVisitorRoleId])
      }

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

  it('create 归属回填：dept_id 取创建者职工部门；无职工行 → NULL；owner 仍为创建者', async () => {
    const deptARows: Array<{ created_by: string, dept_id: string | null }> = await rootApi.pgDataSource.query(
      'SELECT created_by, dept_id FROM app_demo WHERE id = $1',
      [deptA1],
    )
    expect(deptARows[0].created_by).toBe(deptAManager.fixture.userId)
    expect(deptARows[0].dept_id).toBe(deptA)

    const childRows: Array<{ dept_id: string | null }> = await rootApi.pgDataSource.query(
      'SELECT dept_id FROM app_demo WHERE id = $1',
      [childRow],
    )
    expect(childRows[0].dept_id).toBe(deptChild)

    // solo / root 都没有职工行：回填 NULL（仅 ALL/SELF 可见）
    const noDeptRows: Array<{ dept_id: string | null }> = await rootApi.pgDataSource.query(
      'SELECT dept_id FROM app_demo WHERE id = ANY($1::uuid[])',
      [[soloRow, rootRow]],
    )
    expect(noDeptRows.map(row => row.dept_id)).toEqual([null, null])
  })

  it('M1 root（ALL）看到全部 10 行（含无主行）；total 与行集一致', async () => {
    const list = await listDemo(rootApi)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set(allRows()))
    expect(list.total).toBe(allRows().length)
    expect(list.data).toHaveLength(list.total)
  })

  it('M1b deptA-all（ALL，非 root）同样看到全部（ALL 不按部门收窄）', async () => {
    const list = await listDemo(deptAAll.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set(allRows()))
    expect(list.total).toBe(allRows().length)
  })

  it('M2 deptA-manager（DEPT）：只见 deptA 的 3 行；越权 read/update → 404', async () => {
    const list = await listDemo(deptAManager.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([deptA1, deptA2, deptA3]))
    expect(list.total).toBe(3)

    expectNotFound(
      await deptAManager.client.root('GET', deptAManager.client.apiPath(`/app/demo/${deptB1}`)),
      'DEPT user read deptB row',
    )
    expectNotFound(
      await updateDemoOwn(deptAManager.client, deptB1, 'M2-HIJACK'),
      'DEPT user update deptB row',
    )

    // 本部门行可读可改
    expectOk(
      await deptAManager.client.root('GET', deptAManager.client.apiPath(`/app/demo/${deptA1}`)),
      'DEPT user read own dept row',
    )
    expectOk(await updateDemoOwn(deptAManager.client, deptA1, 'M2-OWN'), 'DEPT user update own dept row')
  })

  it('M3 child-manager（DEPT_AND_CHILD）：deptA 3 行 + child 1 行；越权 deptB → 404', async () => {
    const list = await listDemo(childManager.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([deptA1, deptA2, deptA3, childRow]))
    expect(list.total).toBe(4)

    expectNotFound(
      await childManager.client.root('GET', childManager.client.apiPath(`/app/demo/${deptB1}`)),
      'DEPT_AND_CHILD user read deptB row',
    )
    expectNotFound(
      await updateDemoOwn(childManager.client, deptB1, 'M3-HIJACK'),
      'DEPT_AND_CHILD user update deptB row',
    )
    // 子树内的 child 行可读
    expectOk(
      await childManager.client.root('GET', childManager.client.apiPath(`/app/demo/${childRow}`)),
      'DEPT_AND_CHILD user read child row',
    )
  })

  it('M4 deptB-manager（DEPT）：只见 deptB 的 1 行', async () => {
    const list = await listDemo(deptBManager.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([deptB1]))
    expect(list.total).toBe(1)
  })

  it('M5 combo（COMBINE: DEPT deptB + SELF）：deptB 行 ∪ 本人无部门行', async () => {
    const list = await listDemo(combo.client)

    // deptB 腿 = deptB1；SELF 腿 = comboRow（dept 为 NULL，只有 owner 关系）
    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([deptB1, comboRow]))
    expect(list.total).toBe(2)
  })

  it('M6 custom（CUSTOM: deptA+deptB）：两部门行，不含 child / 无部门行', async () => {
    const list = await listDemo(custom.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([deptA1, deptA2, deptA3, deptB1]))
    expect(list.total).toBe(4)

    // 角色 read 回显自定义部门清单（junction 读回）
    const role = await readRole(custom.fixture.mainRoleId)
    expect(new Set(role.deptIds)).toEqual(new Set([deptA, deptB]))
  })

  it('M7 solo（SELF）：仅本人 1 行（无部门归属行按 owner 可见）；改他人 → 404', async () => {
    const list = await listDemo(solo.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([soloRow]))
    expect(list.total).toBe(1)

    expectNotFound(
      await updateDemoOwn(solo.client, deptA1, 'M7-HIJACK'),
      'SELF user update other row',
    )
    expectNotFound(
      await solo.client.root('GET', solo.client.apiPath(`/app/demo/${deptA1}`)),
      'SELF user read other row',
    )
    expectOk(await updateDemoOwn(solo.client, soloRow, 'M7-OWN'), 'SELF user update own row')
  })

  it('M8 visitor（SELF）：仅本人行（visitor 无 create 权限，行由 fixture 归属）', async () => {
    const list = await listDemo(visitor.client)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([visitorRow]))
    expect(list.total).toBe(1)
  })

  it('M9 无角色用户：登录即被拒（40103，空 roles_list 在 opaque 通道统一翻译），无法进入任何数据查询', async () => {
    const attempt = await attemptHttpOpaqueLogin(noRole.client, app, noRole.fixture)

    expect(attempt.code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_CREDENTIALS)
    expect(attempt.data).toBeNull()
  })

  it('M10 缓存失效时序：改档位 / 换清单 / 清空清单，下一请求立即生效', async () => {
    // 预置：CUSTOM(deptA+deptB) 已缓存 → 4 行
    expect((await listDemo(custom.client)).total).toBe(4)

    // 1) 改档位 CUSTOM → DEPT（custom 的 sys_user.dept_id = deptA）→ 3 行
    const deptUpdate = await updateRoleScope(custom.fixture.mainRoleId, {
      dataScope: WalnutAdminConstDataScope.DEPT,
    })
    expect(deptUpdate.dataScope).toBe(WalnutAdminConstDataScope.DEPT)
    expect((await listDemo(custom.client)).total).toBe(3)

    // 2) 换回 CUSTOM 且清单改为 [deptB]（整组替换 sys_role_dept）→ 1 行
    const customB = await updateRoleScope(custom.fixture.mainRoleId, {
      dataScope: WalnutAdminConstDataScope.CUSTOM,
      deptIds: [deptB],
    })
    expect(customB.dataScope).toBe(WalnutAdminConstDataScope.CUSTOM)
    expect(customB.deptIds).toEqual([deptB])
    const afterMove = await listDemo(custom.client)
    expect(new Set(afterMove.data.map(row => row.id))).toEqual(new Set([deptB1]))

    // 3) 清空清单 → 默认拒绝（空集 → SQL 恒假），不是 ALL
    await updateRoleScope(custom.fixture.mainRoleId, {
      dataScope: WalnutAdminConstDataScope.CUSTOM,
      deptIds: [],
    })
    const afterEmpty = await listDemo(custom.client)
    expect(afterEmpty.data).toEqual([])
    expect(afterEmpty.total).toBe(0)

    // 4) 复原清单（不影响后续清理，但让 afterAll 前的状态可预期）
    await updateRoleScope(custom.fixture.mainRoleId, {
      dataScope: WalnutAdminConstDataScope.CUSTOM,
      deptIds: [deptA, deptB],
    })
    expect((await listDemo(custom.client)).total).toBe(4)
  })
})

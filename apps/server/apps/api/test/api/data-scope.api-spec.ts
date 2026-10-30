import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import type { SeedPermissionChainFixture } from './helpers/seed-permissions'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstDataScope } from '@walnut-server/const/app/dataScope'
import { WalnutModelName } from '@walnut-server/db'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { cleanupPermissionChainSeed, seedPermissionChainUser } from './helpers/seed-permissions'

/**
 * 数据权限一期 API 级用例（docs/plans/data-scope-design.md §4）。
 *
 * 模板示范表 app_demo 走真实 HTTP 全链：非 root 用户的 SELF / CUSTOM / ALL 行级
 * 可见面、越权 read/update/delete 一律 404（不泄露行存在性）、create 自动回填
 * owner、角色 dataScope 修改后的缓存失效。
 *
 * fixture 形态：三个非 root 用户（A/B 的 SELF、C 的 CUSTOM）+ 一个只作为 CUSTOM
 * 成员、不登录的裸用户（member）；root 用于全量对照。
 * **每个用户一个独立 device/client**：auth 链禁止同一设备重复登录（40109）。
 * 集成库默认 `app.functional.role` 为空 → effective roleMode = COMBINE；A/B/C 都只有
 * 一个有效角色，COMBINE 与单角色等价（C 的 CUSTOM 成员 = 绑定到该角色的用户）。
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

function demoPayload(demoString: string) {
  return {
    demoString,
    demoPhoneNumber: `139${randomUUID().replaceAll('-', '').slice(0, 8)}`,
    demoNumber: 1,
    demoBoolean: true,
    demoDate: '2026-01-01T00:00:00.000Z',
    demoEnum: 1,
    demoMongoId: randomUUID(),
    demoObject: { o1: 'DS-OBJ', o2: 2, o3: false },
    demoStringArray: ['1', 'a'],
    demoNumberArray: [-1, 2],
    demoBooleanArray: [true],
    demoDateArray: ['2026-01-01T00:00:00.000Z'],
    demoEnumArray: [1, 2],
    demoMongoIdArray: [randomUUID()],
  }
}

describe('数据权限一期：app_demo 行级 scope（SELF / CUSTOM / ALL + 越权 404）', () => {
  let app: NestExpressApplication

  const seed = randomUUID()
  const seed8 = seed.slice(0, 8).toUpperCase()
  const group = `API-DS-${seed8}`

  const clients: WalnutApiClient[] = []
  let rootApi: WalnutApiClient
  let apiA: WalnutApiClient
  let apiB: WalnutApiClient
  let apiC: WalnutApiClient

  let rootFixture: WalnutRootUserFixture
  let userA: SeedPermissionChainFixture
  let userB: SeedPermissionChainFixture
  let userC: SeedPermissionChainFixture
  let memberId = ''
  let memberRoleName = ''

  let rowA = ''
  let rowB = ''
  let rowC = ''
  let rowMember = ''
  const createdIds: string[] = []

  async function createClient(): Promise<WalnutApiClient> {
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

  async function createDemo(client: WalnutApiClient, tag: string): Promise<string> {
    const res = await client.root('POST', client.apiPath('/app/demo'), demoPayload(`${group}-${seed8}-${tag}`))
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

  async function updateUserRoles(
    client: WalnutApiClient,
    fixture: SeedPermissionChainFixture,
    roleIds: string[],
  ): Promise<void> {
    const res = await client.root('PUT', client.apiPath(`/system/user/${fixture.userId}`), {
      userName: fixture.userName,
      status: true,
      roles: roleIds,
    })
    expectOk(res, 'update user roles')
  }

  /** roles 变更会同时清权限缓存（P1-18）：受影响用户需重新拉一次 /auth/permissions */
  async function primePermissions(client: WalnutApiClient): Promise<void> {
    expectOk(await client.root('GET', client.apiPath('/auth/permissions')), 'prime permissions')
  }

  beforeAll(async () => {
    app = await createApiApp()

    rootApi = await createClient()
    apiA = await createClient()
    apiB = await createClient()
    apiC = await createClient()

    rootFixture = await registerRootUserFixture(app, rootApi.pgDataSource, `ds-root-${seed8}`)

    userA = await seedPermissionChainUser(app, rootApi.pgDataSource, {
      userNamePrefix: 'ds-a',
      grantedPermissions: DEMO_PERMISSIONS,
      dataScope: WalnutAdminConstDataScope.SELF,
    })
    userB = await seedPermissionChainUser(app, rootApi.pgDataSource, {
      userNamePrefix: 'ds-b',
      grantedPermissions: DEMO_PERMISSIONS,
      dataScope: WalnutAdminConstDataScope.SELF,
    })
    userC = await seedPermissionChainUser(app, rootApi.pgDataSource, {
      userNamePrefix: 'ds-c',
      grantedPermissions: DEMO_PERMISSIONS,
      dataScope: WalnutAdminConstDataScope.CUSTOM,
    })

    // CUSTOM 成员：只作为角色成员存在（不登录），证明成员清单 ≠ 当前用户自己
    const memberRows: Array<{ id: string }> = await rootApi.pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [`ds-member-${seed8}`],
    )
    memberId = memberRows[0].id
    await rootApi.pgDataSource.query(
      'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2)',
      [memberId, userC.mainRoleId],
    )

    const roleRows: Array<{ role_name: string }> = await rootApi.pgDataSource.query(
      'SELECT role_name FROM sys_role WHERE id = $1',
      [userC.mainRoleId],
    )
    memberRoleName = roleRows[0].role_name

    await loginAs(rootApi, rootFixture)
    await loginAs(apiA, userA)
    await loginAs(apiB, userB)
    await loginAs(apiC, userC)

    rowA = await createDemo(apiA, 'A1')
    rowB = await createDemo(apiB, 'B1')
    rowC = await createDemo(apiC, 'C1')
    // 另造一条 owner = member 的行（C 通过 CUSTOM 成员清单可见；A/B 不可见）
    rowMember = await createDemo(apiC, 'M1')
    await rootApi.pgDataSource.query('UPDATE app_demo SET created_by = $1 WHERE id = $2', [memberId, rowMember])
  })

  afterAll(async () => {
    if (rootApi !== undefined) {
      if (createdIds.length > 0) {
        await rootApi.pgDataSource.query('DELETE FROM app_demo WHERE id = ANY($1::uuid[])', [createdIds])
        await rootApi.pgDataSource.query('DELETE FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])', [createdIds])
      }

      await rootApi.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [memberId])

      await cleanupPermissionChainSeed(rootApi, [userA, userB, userC], clients.map(client => client.deviceId))

      await rootApi.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [rootFixture.userId])
      await rootApi.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [rootFixture.roleId])
      await rootApi.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [clients.map(client => client.deviceId)])

      await rootApi.cleanupWalnutCacheKeys(
        seed8,
        ...clients.map(client => client.deviceId),
        rootFixture.userId,
        userA.userId,
        userB.userId,
        userC.userId,
        memberId,
      )
    }

    await app.close()
  })

  it('create 自动回填 owner（app_demo.created_by = 当前用户）', async () => {
    const rows: Array<{ created_by: string }> = await rootApi.pgDataSource.query(
      'SELECT created_by FROM app_demo WHERE id = $1',
      [rowA],
    )

    expect(rows[0].created_by).toBe(userA.userId)
  })

  it('self：A 的 list 只见自己的行；B/C/member 的行不可见', async () => {
    const list = await listDemo(apiA, 20)

    expect(list.data.map(row => row.id)).toEqual([rowA])
    expect(list.total).toBe(1)
  })

  it('self：A read/update/delete 越权一律 404（不泄露行存在性），自己的行可读可改', async () => {
    const readB = await apiA.root('GET', apiA.apiPath(`/app/demo/${rowB}`))
    expect(bodyOf(readB).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const updateB = await apiA.root('PUT', apiA.apiPath(`/app/demo/${rowB}`), {
      ...demoPayload(`${group}-${seed8}-B2`),
    })
    expect(bodyOf(updateB).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const deleteB = await apiA.root('DELETE', apiA.apiPath(`/app/demo/${rowB}`))
    expect(bodyOf(deleteB).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    // 越权行仍在（root 可见）
    const rootReadB = await rootApi.root('GET', rootApi.apiPath(`/app/demo/${rowB}`))
    expectOk(rootReadB, 'root read B')

    // 自己的行可读可改
    const readA = await apiA.root('GET', apiA.apiPath(`/app/demo/${rowA}`))
    expectOk(readA, 'A read own')
    const updateA = await apiA.root('PUT', apiA.apiPath(`/app/demo/${rowA}`), {
      ...demoPayload(`${group}-${seed8}-A2`),
    })
    expectOk(updateA, 'A update own')
  })

  it('custom：C 可见「本人 + 角色成员」的行；A/B 的行不可见', async () => {
    const list = await listDemo(apiC, 20)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([rowC, rowMember]))

    // C 可读成员的行（CUSTOM 授权范围）
    const readMember = await apiC.root('GET', apiC.apiPath(`/app/demo/${rowMember}`))
    expectOk(readMember, 'C read member row')

    // A 的行仍不可见
    const readA = await apiC.root('GET', apiC.apiPath(`/app/demo/${rowA}`))
    expect(bodyOf(readA).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  })

  it('all（root）：跨用户全量可见', async () => {
    const list = await listDemo(rootApi)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([rowA, rowB, rowC, rowMember]))
  })

  it('角色 dataScope 修改后缓存失效：A 的下一请求按新范围（ALL）过滤', async () => {
    // 先确认当前是 SELF（并填充 AUTH:DATA_SCOPE 缓存）
    expect((await listDemo(apiA, 20)).total).toBe(1)

    // root 把 A 的角色改成 ALL（update DTO 要求 roleName/description/order/status）
    const roleRows: Array<{ role_name: string, description: string | null, sort_order: number | null, status: boolean }>
      = await rootApi.pgDataSource.query(
        'SELECT role_name, description, sort_order, status FROM sys_role WHERE id = $1',
        [userA.mainRoleId],
      )
    const role = roleRows[0]

    const updateRole = await rootApi.root('PUT', rootApi.apiPath(`/system/role/${userA.mainRoleId}`), {
      roleName: role.role_name,
      description: role.description ?? '',
      order: role.sort_order ?? 0,
      status: role.status,
      dataScope: WalnutAdminConstDataScope.ALL,
    })
    expectOk(updateRole, 'root update role dataScope')

    // A 不需要重新登录：缓存失效后按 ALL 重算
    const list = await listDemo(apiA)

    expect(new Set(list.data.map(row => row.id))).toEqual(new Set([rowA, rowB, rowC, rowMember]))
  })

  it('P1：B 被移出 CUSTOM 角色后，同角色成员 C 立即看不到 B 的行', async () => {
    // B 加入 C 的 CUSTOM 角色（root 走 user:update → 触发角色成员失效）
    await updateUserRoles(rootApi, userB, [userB.mainRoleId, userC.mainRoleId])
    // roles 变更同时清了 B 的权限缓存（P1-18），重新拉一次
    await primePermissions(apiB)

    // C 的 CUSTOM 成员集现在包含 B：缓存必须已失效并重算，立即可见 B 的行
    const listWithB = await listDemo(apiC, 20)
    expect(listWithB.data.map(row => row.id)).toEqual(expect.arrayContaining([rowB, rowC, rowMember]))

    // B 移出 C 的角色：C 的缓存（成员快照含 B）必须被角色维度失效
    await updateUserRoles(rootApi, userB, [userB.mainRoleId])
    await primePermissions(apiB)

    const listAfterRemove = await listDemo(apiC, 20)
    expect(listAfterRemove.data.map(row => row.id)).not.toContain(rowB)

    // B 自己回到 SELF
    const listB = await listDemo(apiB, 20)
    expect(listB.data.map(row => row.id)).toEqual([rowB])
  })

  it('P1：删除 CUSTOM 角色成员后其余成员立即看不到其行；恢复不复活 stale 成员快照', async () => {
    // 前置：C 当前看得见 member 的行（成员仍在角色里）
    expect((await listDemo(apiC, 20)).data.map(row => row.id)).toContain(rowMember)

    // root 删除 member（junction 随主行 CASCADE）→ C 的成员快照必须失效
    const deleteRes = await rootApi.root('DELETE', rootApi.apiPath(`/system/user/${memberId}`))
    expectOk(deleteRes, 'root delete member user')

    expect((await listDemo(apiC, 20)).data.map(row => row.id)).not.toContain(rowMember)

    // 恢复 member：user recoverer 不恢复 junction（P2-18 残余），角色成员仍不含他
    const deletedRows: Array<{ id: string }> = await rootApi.pgDataSource.query(
      'SELECT id FROM sys_deleted WHERE deleted_id = $1 AND model_name = $2',
      [memberId, WalnutModelName.SYS_USER],
    )
    expect(deletedRows).toHaveLength(1)

    const recoverRes = await rootApi.root('POST', rootApi.apiPath('/system/deleted/recover'), {
      id: deletedRows[0].id,
      deletedId: memberId,
    })
    expectOk(recoverRes, 'root recover member user')

    const restored: Array<{ id: string }> = await rootApi.pgDataSource.query(
      'SELECT id FROM sys_user WHERE id = $1',
      [memberId],
    )
    expect(restored).toHaveLength(1)

    // 恢复后失效腿不引入 stale 成员快照：C 仍看不到 member 的行
    expect((await listDemo(apiC, 20)).data.map(row => row.id)).not.toContain(rowMember)
  })

  it('角色接口回读 dataScope（Safe 出参含新字段）', async () => {
    const res = await rootApi.root('GET', rootApi.apiPath(`/system/role/${userC.mainRoleId}`))
    expectOk(res, 'role read')

    const data = bodyOf<{ roleName: string, dataScope: number }>(res).data
    expect(data.roleName).toBe(memberRoleName)
    expect(data.dataScope).toBe(WalnutAdminConstDataScope.CUSTOM)
  })
})

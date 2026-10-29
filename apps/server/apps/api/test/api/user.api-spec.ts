import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutModelName } from '@walnut-server/db'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture, WALNUT_DEFAULT_VISITOR_ROLE_UUID } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * C 段：`system/user` CRUD + 状态管理 + `me/role*` 切换语义 + opaque admin clearPassword。
 *
 * - create 的 roles 必填（DTO IsUUID+IsNotEmpty 无 IsOptional）；P1-18 起显式 `roles: []`
 *   得 junction 空 + currentRole=null（与 update 口径对齐；roles 未给才走 defaultRole 兜底）。
 * - safe role id 守卫：create roles 里出现 root/developer 的 v5 uuid → 40000。
 * - 状态管理按 controller 实际端点：CRUD update 的 status 翻转（启停）；
 *   `PATCH /system/user/me/role/switch/:roleId`（COMBINE 模式拒 → 40000）与
 *   `PATCH /system/user/me/roleMode/switch/:roleMode`（switchable ↔ combinable 落库）。
 * - clearPassword 走 opaque admin 通道（`POST /auth/opaque/admin/password/clear`，
 *   权限 system:user:pass:clear）：删 password identity 行，恒 true。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface UserRow {
  id: string
  userName?: string | null
  nickName?: string | null
  status?: boolean
  roles?: string[]
  currentRole?: string | null
  roles_count?: number
  roles_list?: Array<{ id: string, roleName?: string }>
}

describe('C 段：system/user CRUD + me/role 切换 + opaque admin clearPassword（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  /** user_name partial unique；本轮行统一前缀 */
  const userPrefix = `api-spec-user-${seed8}`
  let fixture: WalnutRootUserFixture | null = null
  /** 本轮自建的业务角色（给 create/update 的 roles 用） */
  let bizRoleId = ''

  const collect = {
    userIds: [] as string[],
  }

  function userPayload(tag: string, roles: string[], status = true) {
    return {
      userName: `${userPrefix}-${tag}`,
      status,
      roles,
    }
  }

  async function createUser(tag: string, roles: string[], status = true): Promise<UserRow> {
    const res = await api.root('POST', api.apiPath('/system/user'), userPayload(tag, roles, status))
    expectOk(res, `user create ${tag}`)
    const row = bodyOf<UserRow>(res).data
    collect.userIds.push(row.id)
    return row
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `user-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    const roleRows: Array<{ id: string }> = await api.pgDataSource.query(
      'INSERT INTO sys_role (role_name) VALUES ($1) RETURNING id',
      [`${userPrefix}-role`],
    )
    bizRoleId = roleRows[0].id
  })

  afterEach(async () => {
    if (collect.userIds.length > 0) {
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = ANY($1::uuid[])', [collect.userIds])
      await api.pgDataSource.query('DELETE FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])', [collect.userIds])
      collect.userIds = []
    }
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user WHERE user_name LIKE $1', [`${userPrefix}%`])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE role_name LIKE $1', [`${userPrefix}%`])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('create 带 roles → junction 落行 + currentRole 首角色；read 回 roles_list', async () => {
    const created = await createUser('R1', [bizRoleId])
    expect(created.id).toMatch(UUID_RE)
    expect(created.roles).toEqual([bizRoleId])
    expect(created.currentRole).toBe(bizRoleId)

    const readRes = await api.root('GET', api.apiPath(`/system/user/${created.id}`))
    expectOk(readRes, 'user read')
    const row = bodyOf<UserRow>(readRes).data
    expect(row.userName).toBe(`${userPrefix}-R1`)
    // read 出参不带 roles 数组（那是 create/update 响应的回显）—— 读腿是 roles_list
    expect(row.roles).toBeUndefined()
    expect(row.roles_count).toBe(1)
    expect(row.roles_list?.[0]?.id).toBe(bizRoleId)
  })

  it('create roles=[]（显式空）→ junction 空 + currentRole=null（P1-18：与 update 口径对齐，不再落 defaultRole）', async () => {
    const created = await createUser('D1', [])

    expect(created.roles).toEqual([])
    expect(created.currentRole).toBeNull()

    const readRes = await api.root('GET', api.apiPath(`/system/user/${created.id}`))
    const row = bodyOf<UserRow>(readRes).data
    expect(row.roles_count).toBe(0)
    expect(row.currentRole).toBeNull()

    // DB 列同步为 NULL（current_role_id 可空 = 无当前角色）
    const rows: Array<{ current_role_id: string | null }> = await api.pgDataSource.query(
      'SELECT current_role_id FROM sys_user WHERE id = $1',
      [created.id],
    )
    expect(rows[0].current_role_id).toBeNull()
  })

  it('update → status 翻转（启停）+ roles 整组替换持久化；roles=[] 时 currentRole 归空（P1-18）', async () => {
    const created = await createUser('U1', [bizRoleId])

    const updateRes = await api.root('PUT', api.apiPath(`/system/user/${created.id}`), {
      userName: `${userPrefix}-U1`,
      status: false,
      roles: [],
    })
    expectOk(updateRes, 'user update disable')
    const updated = bodyOf<UserRow>(updateRes).data
    expect(updated.status).toBe(false)
    // P1-18（2026-10-28）：roles 整组替换后 current_role_id 不在新集合 → 归空
    // （旧现状：junction 已空但 currentRole 仍指向已移出的角色）
    expect(updated.currentRole).toBeNull()

    const readRes = await api.root('GET', api.apiPath(`/system/user/${created.id}`))
    const row = bodyOf<UserRow>(readRes).data
    expect(row.status).toBe(false)
    expect(row.roles_count).toBe(0)
    expect(row.currentRole).toBeNull()

    // 再启回来 + 换角色
    const enableRes = await api.root('PUT', api.apiPath(`/system/user/${created.id}`), {
      userName: `${userPrefix}-U1`,
      status: true,
      roles: [bizRoleId],
    })
    expectOk(enableRes, 'user update enable')
    expect(bodyOf<UserRow>(enableRes).data.status).toBe(true)
    expect(bodyOf<UserRow>(enableRes).data.currentRole).toBe(bizRoleId)
  })

  it('P1-18：移除 current 角色后 currentRole 重置为新集合首角色（不再沿用已移出角色）', async () => {
    const created = await createUser('CUR', [bizRoleId])
    expect(created.currentRole).toBe(bizRoleId)

    // 换成 visitor 角色（fixture beforeAll 已确保该行存在）—— current 角色被移出
    const updateRes = await api.root('PUT', api.apiPath(`/system/user/${created.id}`), {
      userName: `${userPrefix}-CUR`,
      status: true,
      roles: [WALNUT_DEFAULT_VISITOR_ROLE_UUID],
    })
    expectOk(updateRes, 'user update replace current role')
    expect(bodyOf<UserRow>(updateRes).data.currentRole).toBe(WALNUT_DEFAULT_VISITOR_ROLE_UUID)

    const rows: Array<{ current_role_id: string | null }> = await api.pgDataSource.query(
      'SELECT current_role_id FROM sys_user WHERE id = $1',
      [created.id],
    )
    expect(rows[0].current_role_id).toBe(WALNUT_DEFAULT_VISITOR_ROLE_UUID)
  })

  it('list → userName 过滤 + roles_count（list 出参裁剪字段面）', async () => {
    await createUser('L1', [bizRoleId])

    const listRes = await api.root('POST', api.apiPath('/system/user/list'), {
      query: { userName: `${userPrefix}-L1` },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'user list')
    const list = bodyOf<{ data: UserRow[], total: number }>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].userName).toBe(`${userPrefix}-L1`)
    expect(list.data[0].roles_count).toBe(1)
    // SysUserDTOListResponse 只 pick id/userName/nickName/status/createdAt/updatedAt/roles_count
    expect(list.data[0].roles).toBeUndefined()
    expect(list.data[0].roles_list).toBeUndefined()
  })

  it('me/role/switch：行值 COMBINE 拒（40000）；零配置下 switchable + junction 双角色可切（P2-19）', async () => {
    // fixture 行值 combinable：switch 直接拒
    const combineSwitch = await api.root('PATCH', api.apiPath(`/system/user/me/role/switch/${bizRoleId}`))
    expect(bodyOf(combineSwitch).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    // 切到 switchable 后：不在 junction 的角色拒
    const toSwitchable = await api.root('PATCH', api.apiPath('/system/user/me/roleMode/switch/switchable'))
    expectOk(toSwitchable, 'roleMode switch to switchable')

    const badRoleSwitch = await api.root('PATCH', api.apiPath(`/system/user/me/role/switch/${bizRoleId}`))
    expect(bodyOf(badRoleSwitch).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const roleModeRows: Array<{ role_mode: string }> = await api.pgDataSource.query(
      'SELECT role_mode FROM sys_user WHERE id = $1',
      [fixture!.userId],
    )
    expect(roleModeRows[0].role_mode).toBe('switchable')

    // P2-19（2026-10-29）：零配置部署（effective=GLOBAL/combinable）下行值 switchable +
    // 目标角色在 junction 内必须可切 —— 旧实现按 effective 判，恒 40000。
    await api.pgDataSource.query(
      'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2)',
      [fixture!.userId, bizRoleId],
    )

    const switchRes = await api.root('PATCH', api.apiPath(`/system/user/me/role/switch/${bizRoleId}`))
    expectOk(switchRes, 'switchRole to second junction role (zero-config)')

    const switchedRows: Array<{ current_role_id: string }> = await api.pgDataSource.query(
      'SELECT current_role_id FROM sys_user WHERE id = $1',
      [fixture!.userId],
    )
    expect(switchedRows[0].current_role_id).toBe(bizRoleId)

    // 切回原角色 + 清掉临时 junction 行（后续用例仍以单角色 fixture 为前提）
    const backRes = await api.root('PATCH', api.apiPath(`/system/user/me/role/switch/${fixture!.roleId}`))
    expectOk(backRes, 'switchRole back to root role')

    await api.pgDataSource.query(
      'DELETE FROM sys_user_role WHERE user_id = $1 AND role_id = $2',
      [fixture!.userId, bizRoleId],
    )
  })

  it('me/roleMode/switch：switchable → combinable 落库，非法枚举 → 40002', async () => {
    const backToCombine = await api.root('PATCH', api.apiPath('/system/user/me/roleMode/switch/combinable'))
    expectOk(backToCombine, 'roleMode switch back to combinable')
    expect(bodyOf<boolean>(backToCombine).data).toBe(true)

    const rows: Array<{ role_mode: string }> = await api.pgDataSource.query(
      'SELECT role_mode FROM sys_user WHERE id = $1',
      [fixture!.userId],
    )
    expect(rows[0].role_mode).toBe('combinable')

    const badMode = await api.root('PATCH', api.apiPath('/system/user/me/roleMode/switch/hybrid'))
    expect(bodyOf(badMode).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('delete：删自己 → 40000；删 safe user id → 40000；删他人 → 软删快照 + read 40401', async () => {
    const deleteSelf = await api.root('DELETE', api.apiPath(`/system/user/${fixture!.userId}`))
    expect(bodyOf(deleteSelf).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const deleteSafe = await api.root('DELETE', api.apiPath('/system/user/7323c6ec-322f-588d-bb6a-81a768912c35'))
    expect(bodyOf(deleteSafe).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const victim = await createUser('DEL', [])
    const deleteRes = await api.root('DELETE', api.apiPath(`/system/user/${victim.id}`))
    expectOk(deleteRes, 'user delete other')
    collect.userIds = collect.userIds.filter(id => id !== victim.id)

    const readRes = await api.root('GET', api.apiPath(`/system/user/${victim.id}`))
    expect(bodyOf(readRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const snapshots: Array<{ model_name: string }> = await api.pgDataSource.query(
      'SELECT model_name FROM sys_deleted WHERE deleted_id = $1',
      [victim.id],
    )
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].model_name).toBe(WalnutModelName.SYS_USER)
  })

  it('create roles 含 safe role id → 40000；缺 roles → 40099', async () => {
    const safeRole = await api.root('POST', api.apiPath('/system/user'), userPayload('S1', ['3055c85c-8f55-53c9-8c7a-366fef0a8183']))
    expect(bodyOf(safeRole).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const missingRoles = await api.root('POST', api.apiPath('/system/user'), {
      userName: `${userPrefix}-S2`,
      status: true,
    })
    expect(bodyOf(missingRoles).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('opaque admin clearPassword → true，password identity 行删除；再清恒 true', async () => {
    // fixture 经真实 opaque 注册落了 password identity（purpose=login）
    const before: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_identity WHERE user_id = $1 AND type = $2',
      [fixture!.userId, 'password'],
    )
    expect(before[0].c).toBe(1)

    const clearRes = await api.root('POST', api.apiPath('/auth/opaque/admin/password/clear'), {
      id: fixture!.userId,
    })
    expectOk(clearRes, 'opaque admin clearPassword')
    expect(bodyOf<boolean>(clearRes).data).toBe(true)

    const after: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_identity WHERE user_id = $1 AND type = $2',
      [fixture!.userId, 'password'],
    )
    expect(after[0].c).toBe(0)

    // 无行也恒 true（identity 存在性检查后才删，幂等）
    const clearAgain = await api.root('POST', api.apiPath('/auth/opaque/admin/password/clear'), {
      id: fixture!.userId,
    })
    expectOk(clearAgain, 'opaque admin clearPassword again')
  })

  it('create 用户名重复 → DB 23505 映射为受控 40000（P1-7：不再兜底 50000）', async () => {
    await createUser('DUP', [])
    const duplicate = await api.root('POST', api.apiPath('/system/user'), userPayload('DUP', []))
    // 响应形态不变（HTTP 200 + 业务码壳），handler 把 23505 收敛为 BAD_REQUEST，约束名进 _devMsg
    expect(duplicate.status).toBe(200)
    expect(bodyOf(duplicate).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect((bodyOf(duplicate) as unknown as { _devMsg?: string })._devMsg).toContain('uq_user_name')
  })
})

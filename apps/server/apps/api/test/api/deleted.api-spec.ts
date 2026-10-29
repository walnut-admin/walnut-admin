import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import type { SeedPermissionChainFixture } from './helpers/seed-permissions'
import { randomUUID } from 'node:crypto'
import { WalnutModelName } from '@walnut-server/db'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { cleanupPermissionChainSeed, seedPermissionChainUser } from './helpers/seed-permissions'

/**
 * D 段：`system/deleted` 回收站（真实 HTTP 全链，B9 int-spec 已覆盖 service 层，
 * 本文件 HTTP 层复刻核心三态）：
 *
 * - 造数据（app/demo 标准.create）→ HTTP delete（软删进 sys_deleted）→
 *   read（快照 content + user）/ list（content ::text 模糊过滤 + 分页）；
 * - `POST me/recover`：属主语义闭环（root 恢复自己删的行 → 原行回来 + sys_deleted 行消失）；
 *   错误路径：deletedId 不匹配 → 40401（id+deletedId 双键定位不命中）；
 * - `POST recover`（管理端 @HasRole 三角色，root 短路放行）：再造 → 管理端恢复；
 *   错误路径：deletedId 不匹配 → 40000 recoverFail；
 * - P3-21：`me/recover` 挂 `system:deleted:recover:mine`（与管理端 `system:deleted:recover`
 *   解耦）—— 非 root 双用户用例：只有 recover:mine 者可恢复自己删的行、只有管理端权限者 40105；
 * - `DELETE deleteMany/:ids`（deleteReal）：快照行硬删，原表不回来。
 *
 * 列表过滤用 content 关键字（jsonb ::text ILIKE，唯一 demoString 片段）—— deletedBy
 * 是 uuid 列不走模糊白名单，HTTP 层不赌 uuid 过滤行为。
 */

interface DemoRow {
  id: string
  demoString?: string
}

interface DeletedRow {
  id: string
  deletedId?: string
  modelName?: string
  deletedBy?: string
  content?: Record<string, unknown>
  user?: { id: string, userName: string | null } | null
}

interface DeletedListData {
  data: DeletedRow[]
  total: number
}

describe('D 段：system/deleted 回收站 read/list/recover/recoverMine/deleteReal（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  // demoString 挂 IsUppercase：uuid 片段的 hex 字母整体抬大写（A 段试点同款口径）
  const group = `API-DELETED-${seed8.toUpperCase()}`
  let fixture: WalnutRootUserFixture | null = null
  /** 全部 SQL 直删清场的 demo 行 id（含恢复出来的） */
  const demoIds: string[] = []
  /** 清场兜底：按 deletedId 清 sys_deleted */
  const deletedDemoIds: string[] = []
  /** P2-18 用例自建的 user 行（恢复后仍在，afterAll 直删） */
  const recoveredUserIds: string[] = []
  /** P3-21：只持有 recover:mine 的非 root 用户（可恢复自己删的行） */
  let mineUser: WalnutApiClient | null = null
  let mineFixture: SeedPermissionChainFixture | null = null
  /** P3-21：只持有管理端 recover 的非 root 用户（me/recover 应被拒） */
  let manageOnlyUser: WalnutApiClient | null = null
  let manageOnlyFixture: SeedPermissionChainFixture | null = null

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `deleted-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // P3-21 权限面：两个非 root 用户，权限点互斥（junction 走 seed helper 的真实角色链）
    mineFixture = await seedPermissionChainUser(app, api.pgDataSource, {
      userNamePrefix: `deleted-mine-${seed8}`,
      grantedPermissions: ['app:demo:create', 'app:demo:delete', 'system:deleted:recover:mine'],
    })
    mineUser = await WalnutApiClient.create(app)
    const mineTokens = await performHttpOpaqueLogin(mineUser, app, mineFixture)
    mineUser.setAuth(mineTokens)
    await mineUser.seedMfaVerifiedCache(mineFixture.userId)
    expectOk(await mineUser.root('GET', mineUser.apiPath('/auth/permissions')), 'mine user permissions cache')

    manageOnlyFixture = await seedPermissionChainUser(app, api.pgDataSource, {
      userNamePrefix: `deleted-manage-${seed8}`,
      grantedPermissions: ['system:deleted:recover'],
    })
    manageOnlyUser = await WalnutApiClient.create(app)
    const manageOnlyTokens = await performHttpOpaqueLogin(manageOnlyUser, app, manageOnlyFixture)
    manageOnlyUser.setAuth(manageOnlyTokens)
    await manageOnlyUser.seedMfaVerifiedCache(manageOnlyFixture.userId)
    expectOk(await manageOnlyUser.root('GET', manageOnlyUser.apiPath('/auth/permissions')), 'manage-only user permissions cache')
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      if (deletedDemoIds.length > 0) {
        await api.pgDataSource.query('DELETE FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])', [deletedDemoIds])
      }
      if (demoIds.length > 0) {
        await api.pgDataSource.query('DELETE FROM app_demo WHERE id = ANY($1::uuid[])', [demoIds])
      }
      if (recoveredUserIds.length > 0) {
        await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content ->> \'userId\' = ANY($1::text[])', [recoveredUserIds])
        await api.pgDataSource.query('DELETE FROM sys_user WHERE id = ANY($1::uuid[])', [recoveredUserIds])
      }
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)

      // P3-21 种子用户（user / role / element 菜单 / 权限缓存 + 设备行）
      const seedFixtures = [mineFixture, manageOnlyFixture].filter((i): i is SeedPermissionChainFixture => i !== null)
      const seedDevices = [mineUser?.deviceId, manageOnlyUser?.deviceId].filter((i): i is string => typeof i === 'string')
      if (seedFixtures.length > 0) {
        await cleanupPermissionChainSeed(api, seedFixtures, seedDevices)
      }
    }
    await app.close()
  })

  function demoPayload(tag: string) {
    return {
      demoString: `${group}-${tag}`,
      demoPhoneNumber: `138${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      demoNumber: 1,
      demoBoolean: true,
      demoDate: '2026-01-01T00:00:00.000Z',
      demoEnum: 1,
      demoMongoId: randomUUID(),
      demoObject: { o1: 'OBJ', o2: 2, o3: false },
      demoStringArray: ['1', 'a'],
      demoNumberArray: [-1, 2],
      demoBooleanArray: [true],
      demoDateArray: ['2026-01-01T00:00:00.000Z'],
      demoEnumArray: [1, 2],
      demoMongoIdArray: [randomUUID()],
    }
  }

  async function createDemo(tag: string): Promise<DemoRow> {
    const res = await api.root('POST', api.apiPath('/app/demo'), demoPayload(tag))
    expectOk(res, `demo create ${tag}`)
    const row = bodyOf<DemoRow>(res).data
    demoIds.push(row.id)
    return row
  }

  async function deleteDemoViaHttp(id: string): Promise<void> {
    const res = await api.root('DELETE', api.apiPath(`/app/demo/${id}`))
    expectOk(res, `demo delete ${id}`)
    deletedDemoIds.push(id)
  }

  async function findSnapshotByDeletedId(deletedId: string): Promise<DeletedRow> {
    const res = await api.root('POST', api.apiPath('/system/deleted/list'), {
      query: { content: `${seed8}` },
      page: { page: 1, pageSize: 50 },
    })
    expectOk(res, 'deleted list (locate snapshot)')
    const list = bodyOf<DeletedListData>(res).data
    const hit = list.data.find(row => row.deletedId === deletedId)
    expect(hit).toBeTruthy()
    return hit!
  }

  it('造数据 → 软删 → read：快照 content/modelName + user；list content 模糊过滤命中', async () => {
    const demo = await createDemo('R1')
    await deleteDemoViaHttp(demo.id)

    // 原行已消失
    const goneRes = await api.root('GET', api.apiPath(`/app/demo/${demo.id}`))
    expect(bodyOf(goneRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    // 回收站 read（定位键是 sys_deleted 行自己的 id）
    const snapshot = await findSnapshotByDeletedId(demo.id)
    const readRes = await api.root('GET', api.apiPath(`/system/deleted/${snapshot.id}`))
    expectOk(readRes, 'deleted read')

    const read = bodyOf<DeletedRow>(readRes).data
    expect(read.id).toBe(snapshot.id)
    expect(read.deletedId).toBe(demo.id)
    expect(read.modelName).toBe(WalnutModelName.APP_DEMO)
    expect(read.deletedBy).toBe(fixture!.userId)
    expect((read.content as { demoString?: string }).demoString)
      .toBe(demo.demoString!.toUpperCase()) // 快照按存储原样带回（demoString 入库大写；create 响应面是大小写宽松的，A 段 list 断言同样 toUpperCase 对拍）
    expect(read.user).toMatchObject({ id: fixture!.userId, userName: fixture!.userName })

    // list：content ::text 关键字过滤（本组唯一标记）+ 分页
    const listRes = await api.root('POST', api.apiPath('/system/deleted/list'), {
      query: { content: `${group}-R1` },
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'deleted list filtered')
    const list = bodyOf<DeletedListData>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].deletedId).toBe(demo.id)
    // list 出参不带 content（DTO Safe 层剔除）
    expect(list.data[0].content).toBeUndefined()
  })

  it('recoverMine：属主恢复自己删的行 → 原行回来 + sys_deleted 行同事务消失', async () => {
    const demo = await createDemo('M1')
    await deleteDemoViaHttp(demo.id)
    const snapshot = await findSnapshotByDeletedId(demo.id)

    const res = await api.root('POST', api.apiPath('/system/deleted/me/recover'), {
      id: snapshot.id,
      deletedId: demo.id,
    })
    expectOk(res, 'deleted recoverMine')
    expect(bodyOf<boolean>(res).data).toBe(true)

    // 原行回来（字段一致）
    const backRes = await api.root('GET', api.apiPath(`/app/demo/${demo.id}`))
    expectOk(backRes, 'demo recovered')
    expect(bodyOf<DemoRow>(backRes).data.demoString).toBe(demo.demoString)

    // 快照行消失
    const remainRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_deleted WHERE id = $1',
      [snapshot.id],
    )
    expect(remainRows[0].c).toBe(0)
    deletedDemoIds.pop()
  })

  it('recoverMine 错误路径：deletedId 不匹配 → 40401（双键定位不命中）', async () => {
    const demo = await createDemo('M2')
    await deleteDemoViaHttp(demo.id)
    const snapshot = await findSnapshotByDeletedId(demo.id)

    const res = await api.root('POST', api.apiPath('/system/deleted/me/recover'), {
      id: snapshot.id,
      deletedId: randomUUID(),
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    // 快照未被误删
    const remainRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_deleted WHERE id = $1',
      [snapshot.id],
    )
    expect(remainRows[0].c).toBe(1)
  })

  it('P3-21：me/recover 走 system:deleted:recover:mine —— 非 root 只有 recover:mine 可恢复自己删的行，只有管理端 recover 被拒 40105', async () => {
    // 用户 A（recover:mine）：自己建、自己删 → 快照 deletedBy = A（属主语义闭环）
    const createdRes = await mineUser!.root('POST', mineUser!.apiPath('/app/demo'), demoPayload('P21'))
    expectOk(createdRes, 'demo create by mine user')
    const demo = bodyOf<DemoRow>(createdRes).data
    demoIds.push(demo.id)

    const delRes = await mineUser!.root('DELETE', mineUser!.apiPath(`/app/demo/${demo.id}`))
    expectOk(delRes, 'demo delete by mine user')
    deletedDemoIds.push(demo.id)

    const snapshotRows: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM sys_deleted WHERE deleted_id = $1',
      [demo.id],
    )
    expect(snapshotRows).toHaveLength(1)
    const snapshotId = snapshotRows[0].id

    // 用户 B（只有管理端 system:deleted:recover）→ 新权限点不命中，40105（权限点已解耦）
    const deniedRes = await manageOnlyUser!.root('POST', manageOnlyUser!.apiPath('/system/deleted/me/recover'), {
      id: snapshotId,
      deletedId: demo.id,
    })
    expect(bodyOf(deniedRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION)

    // 用户 A → recover:mine 命中，属主恢复成功
    const okRes = await mineUser!.root('POST', mineUser!.apiPath('/system/deleted/me/recover'), {
      id: snapshotId,
      deletedId: demo.id,
    })
    expectOk(okRes, 'deleted recoverMine with dedicated permission')
    expect(bodyOf<boolean>(okRes).data).toBe(true)
    deletedDemoIds.pop()

    // 原行回来 + 快照行消失
    const backRes = await api.root('GET', api.apiPath(`/app/demo/${demo.id}`))
    expectOk(backRes, 'demo recovered by mine user')
    const remainRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_deleted WHERE id = $1',
      [snapshotId],
    )
    expect(remainRows[0].c).toBe(0)
  })

  it('recover（管理端）→ 恢复成功；deletedId 不匹配 → 40000 recoverFail', async () => {
    const demo = await createDemo('A1')
    await deleteDemoViaHttp(demo.id)
    const snapshot = await findSnapshotByDeletedId(demo.id)

    const badRes = await api.root('POST', api.apiPath('/system/deleted/recover'), {
      id: snapshot.id,
      deletedId: randomUUID(),
    })
    expect(bodyOf(badRes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const res = await api.root('POST', api.apiPath('/system/deleted/recover'), {
      id: snapshot.id,
      deletedId: demo.id,
    })
    expectOk(res, 'deleted recover (admin)')
    expect(bodyOf<boolean>(res).data).toBe(true)

    const backRes = await api.root('GET', api.apiPath(`/app/demo/${demo.id}`))
    expectOk(backRes, 'demo recovered via admin')
    deletedDemoIds.pop()
  })

  it('deleteMany（deleteReal）→ 快照行硬删，原表不回来', async () => {
    const demo = await createDemo('D1')
    await deleteDemoViaHttp(demo.id)
    const snapshot = await findSnapshotByDeletedId(demo.id)

    const res = await api.root('DELETE', api.apiPath(`/system/deleted/deleteMany/${snapshot.id}`))
    expectOk(res, 'deleted deleteReal')
    expect(bodyOf<DeletedRow[]>(res).data.map(i => i.id)).toEqual([snapshot.id])

    const remainRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_deleted WHERE id = $1',
      [snapshot.id],
    )
    expect(remainRows[0].c).toBe(0)

    // 原行不回来
    const goneRes = await api.root('GET', api.apiPath(`/app/demo/${demo.id}`))
    expect(bodyOf(goneRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
    deletedDemoIds.pop()
  })

  it('P2-18：删用户 → 外围行（identity/preference）同事务进快照；recover 用户 → 联动恢复', async () => {
    const userName = `deleted-user-${seed8}`
    const createRes = await api.root('POST', api.apiPath('/system/user'), {
      userName,
      status: true,
      roles: [],
    })
    expectOk(createRes, 'user create for recover')
    const created = bodyOf<{ id: string }>(createRes).data
    recoveredUserIds.push(created.id)

    // 外围行：口令 identity（value 是 select:false 密文列，快照必须带出）+ 偏好行
    await api.pgDataSource.query(
      `INSERT INTO sys_user_identity (user_id, type, purpose, value, value_hash, masked_value)
       VALUES ($1, 'password', 'login', 'cipher-value-p2-18', $2, '***')`,
      [created.id, `hash-${seed8}`],
    )
    await api.pgDataSource.query('INSERT INTO sys_user_preference (user_id) VALUES ($1)', [created.id])

    const delRes = await api.root('DELETE', api.apiPath(`/system/user/${created.id}`))
    expectOk(delRes, 'user soft delete')

    // 修复前：只有 SysUser 一份快照（外围行被 FK CASCADE 静默带走）。现在主行删除前
    // 已给外围行各落一份快照。
    const snapshotRows: Array<{ id: string, model_name: string }> = await api.pgDataSource.query(
      `SELECT id, model_name FROM sys_deleted
       WHERE deleted_id = $1::uuid OR content ->> 'userId' = $1::text
       ORDER BY model_name`,
      [created.id],
    )
    const models = snapshotRows.map(row => row.model_name)
    expect(models).toEqual(expect.arrayContaining(['SysUser', 'SysUserIdentity', 'SysUserPreference']))

    const userSnapshot = snapshotRows.find(row => row.model_name === 'SysUser')
    expect(userSnapshot).toBeTruthy()

    // F2：回收站 read 出参对凭据密文脱敏（identity.value / MFA 四列 → `***`），
    // 但恢复走实体读取 sys_deleted.content，密文本身不受影响（恢复后断言）
    const identitySnapshot = snapshotRows.find(row => row.model_name === 'SysUserIdentity')
    expect(identitySnapshot).toBeTruthy()
    const identityReadRes = await api.root('GET', api.apiPath(`/system/deleted/${identitySnapshot!.id}`))
    expectOk(identityReadRes, 'deleted read (identity snapshot)')
    const identitySnapshotContent = bodyOf<{ content: Record<string, unknown> }>(identityReadRes).data.content
    expect(identitySnapshotContent.value).toBe('***')
    // 非密文字段原样（定位/可读性不受影响）
    expect(identitySnapshotContent.type).toBe('password')
    expect(identitySnapshotContent.purpose).toBe('login')

    const recoverRes = await api.root('POST', api.apiPath('/system/deleted/recover'), {
      id: userSnapshot!.id,
      deletedId: created.id,
    })
    expectOk(recoverRes, 'user recover with peripherals')

    // 主行回来
    const userRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user WHERE id = $1',
      [created.id],
    )
    expect(userRows[0].c).toBe(1)

    // 外围行联动恢复（identity 的密文 value 完整带回 —— 登录凭据可用）
    const identityRows: Array<{ value: string, masked_value: string }> = await api.pgDataSource.query(
      'SELECT value, masked_value FROM sys_user_identity WHERE user_id = $1',
      [created.id],
    )
    expect(identityRows).toHaveLength(1)
    expect(identityRows[0].value).toBe('cipher-value-p2-18')
    expect(identityRows[0].masked_value).toBe('***')

    const preferenceRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_preference WHERE user_id = $1',
      [created.id],
    )
    expect(preferenceRows[0].c).toBe(1)

    // 外围快照已消费（不再留在回收站）
    const remainRows: Array<{ c: number }> = await api.pgDataSource.query(
      `SELECT count(*)::int AS c FROM sys_deleted WHERE content ->> 'userId' = $1`,
      [created.id],
    )
    expect(remainRows[0].c).toBe(0)
  })
})

import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * D 段：`system/deleted` 回收站（真实 HTTP 全链，B9 int-spec 已覆盖 service 层，
 * 本文件 HTTP 层复刻核心三态）：
 *
 * - 造数据（app/demo 标准.create）→ HTTP delete（软删进 sys_deleted）→
 *   read（快照 content + populated_user）/ list（content ::text 模糊过滤 + 分页）；
 * - `POST me/recover`：属主语义闭环（root 恢复自己删的行 → 原行回来 + sys_deleted 行消失）；
 *   错误路径：deletedId 不匹配 → 40401（id+deletedId 双键定位不命中）；
 * - `POST recover`（管理端 @HasRole 三角色，root 短路放行）：再造 → 管理端恢复；
 *   错误路径：deletedId 不匹配 → 40000 recoverFail；
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
  populated_user?: { id: string, userName: string | null } | null
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

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `deleted-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      if (deletedDemoIds.length > 0) {
        await api.pgDataSource.query('DELETE FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])', [deletedDemoIds])
      }
      if (demoIds.length > 0) {
        await api.pgDataSource.query('DELETE FROM app_demo WHERE id = ANY($1::uuid[])', [demoIds])
      }
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
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

  it('造数据 → 软删 → read：快照 content/modelName + populated_user；list content 模糊过滤命中', async () => {
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
    expect(read.modelName).toBe(WalnutDBModelName.APP_DEMO)
    expect(read.deletedBy).toBe(fixture!.userId)
    expect((read.content as { demoString?: string }).demoString)
      .toBe(demo.demoString!.toUpperCase()) // 快照按存储原样带回（demoString 入库大写；create 响应面是大小写宽松的，A 段 list 断言同样 toUpperCase 对拍）
    expect(read.populated_user).toMatchObject({ id: fixture!.userId, userName: fixture!.userName })

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
})

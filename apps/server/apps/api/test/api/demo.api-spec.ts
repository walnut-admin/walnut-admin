import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutModelName } from '@walnut-server/db'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * A 段试点：`POST /app/demo`（标准 CRUD 模板，WalnutCrudDecorators 全形态）走真实
 * HTTP 全链（全局 guard 链 + ValidationPipe + ClassSerializer + 事务拦截器 + 异常过滤器）。
 *
 * 覆盖：CRUD 全闭环（create → read → update → list 过滤/分页 → delete → deleteMany
 * → read 404）、入参校验失败（forbidNonWhitelisted / IsUppercase，body.code=40000）、
 * 未登录 401 路径（JwtAccessGuard，body.code=40101）、软删进回收站（sys_deleted 行）。
 *
 * 登录形态：describe 级 beforeAll 完成握手 + opaque 注册/登录（root 短路权限，
 * MFA 设备 verified 缓存走真实缓存通道）；数据 afterEach 清，库/缓存 afterAll 收口。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** AppDemoDTOCreateResponse 的被验字段面 */
interface DemoRow {
  id: string
  demoString?: string
  demoNumber?: number
  demoBoolean?: boolean
  demoEnum?: number
  demoObject?: { o1?: string, o2?: number, o3?: boolean }
  demoPhoneNumber?: string
}

interface DemoListData {
  data: DemoRow[]
  total: number
}

function demoPayload(demoString: string) {
  return {
    // demoString 挂 IsUppercase、demoStringArray 挂 IsLowercase + contains('1') 校验；
    // demoNumber 按列型定稿是 integer（schema 的 Mongo 时代 precision 校验已随 A 段试点
    // 修正为 int）；数组列为 phase2 4.20 NOT NULL 显式给值（create DTO 已补齐字段）
    demoString,
    demoPhoneNumber: `138${randomUUID().replaceAll('-', '').slice(0, 8)}`,
    demoNumber: 1,
    demoBoolean: true,
    demoDate: '2026-01-01T00:00:00.000Z',
    demoEnum: 1,
    demoMongoId: randomUUID(),
    demoObject: { o1: 'OBJ-TITLE', o2: 2, o3: false },
    demoStringArray: ['1', 'a'],
    demoNumberArray: [-1, 2],
    demoBooleanArray: [true],
    demoDateArray: ['2026-01-01T00:00:00.000Z'],
    demoEnumArray: [1, 2],
    demoMongoIdArray: [randomUUID()],
  }
}

describe('A 段试点：app/demo 标准 CRUD（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed = randomUUID()
  // IsUppercase：uuid 片段的 hex 字母要抬成大写
  const seed8 = seed.slice(0, 8).toUpperCase()
  /** 本轮 demo 行的 demoString 分组前缀（IsUppercase：全大写） */
  const group = `API-DEMO-${seed8}`
  /** afterEach 清理收集的 id（PG 侧硬删，软删行随 afterAll 一并清） */
  let createdIds: string[] = []
  let fixture: WalnutRootUserFixture | null = null
  let userId = ''

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `demo-${seed8}`)
    userId = fixture.userId

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterEach(async () => {
    if (createdIds.length > 0) {
      await api.pgDataSource.query('DELETE FROM app_demo WHERE id = ANY($1::uuid[])', [createdIds])
      await api.pgDataSource.query('DELETE FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])', [createdIds])
      createdIds = []
    }
  })

  afterAll(async () => {
    // 登录/设备/会话/nonce 等缓存键按本轮 seed 与主键片段清；PG 侧 user 级联
    // （identity / junction / user_device / refresh）+ 角色 + 设备行收口
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, userId)
    }
    await app.close()
  })

  it('create → 20000，回带 uuid 主键', async () => {
    const res = await api.root('POST', api.apiPath('/app/demo'), demoPayload(`${group}-${seed8}-C1`))
    expectOk(res, 'demo create')

    const row = bodyOf<DemoRow>(res).data
    expect(row.id).toMatch(UUID_RE)
    createdIds.push(row.id)
  })

  it('read → 20000，字段回读一致', async () => {
    const createRes = await api.root('POST', api.apiPath('/app/demo'), demoPayload(`${group}-${seed8}-R1`))
    expectOk(createRes, 'demo create')
    const id = bodyOf<DemoRow>(createRes).data.id
    createdIds.push(id)

    const readRes = await api.root('GET', api.apiPath(`/app/demo/${id}`))
    expectOk(readRes, 'demo read')

    const row = bodyOf<DemoRow>(readRes).data
    expect(row.id).toBe(id)
    expect(row.demoNumber).toBe(1)
    expect(row.demoBoolean).toBe(true)
    expect(row.demoEnum).toBe(1)
    expect(row.demoObject?.o2).toBe(2)
  })

  it('update → 20000，修改持久化', async () => {
    const createRes = await api.root('POST', api.apiPath('/app/demo'), demoPayload(`${group}-${seed8}-U1`))
    expectOk(createRes, 'demo create')
    const created = bodyOf<DemoRow>(createRes).data
    createdIds.push(created.id)

    const updateRes = await api.root('PUT', api.apiPath(`/app/demo/${created.id}`), {
      demoString: `${group}-${seed8}-U2`,
      demoPhoneNumber: created.demoPhoneNumber,
      demoNumber: 42,
      demoBoolean: false,
      demoDate: '2026-02-02T00:00:00.000Z',
      demoEnum: 2,
      demoMongoId: randomUUID(),
      demoObject: { o1: 'OBJ-2', o2: 3, o3: true },
      demoStringArray: ['1', 'b'],
      demoNumberArray: [-1, 3],
      demoBooleanArray: [false],
      demoDateArray: ['2026-02-02T00:00:00.000Z'],
      demoEnumArray: [2, 3],
      demoMongoIdArray: [randomUUID()],
    })
    expectOk(updateRes, 'demo update')
    expect(bodyOf<DemoRow>(updateRes).data.demoNumber).toBe(42)
    expect(bodyOf<DemoRow>(updateRes).data.demoEnum).toBe(2)

    const readRes = await api.root('GET', api.apiPath(`/app/demo/${created.id}`))
    expect(bodyOf<DemoRow>(readRes).data.demoNumber).toBe(42)
  })

  it('list → 过滤命中本组 + 分页生效', async () => {
    for (const tag of ['L1', 'L2', 'L3']) {
      const res = await api.root('POST', api.apiPath('/app/demo'), demoPayload(`${group}-${seed8}-${tag}`))
      expectOk(res, `demo create ${tag}`)
      createdIds.push(bodyOf<DemoRow>(res).data.id)
    }

    // 过滤：字符串字段是 ILIKE 子串模糊（pg-list.builder 对 %/_ 做字面量转义，
    // 不能自造通配符 —— 用分组前缀做子串）
    const filtered = await api.root('POST', api.apiPath('/app/demo/list'), {
      filters: [{ field: 'demoString', op: 'like', value: group }],
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(filtered, 'demo list filtered')
    const filteredList = bodyOf<DemoListData>(filtered).data
    expect(filteredList.total).toBeGreaterThanOrEqual(3)
    for (const row of filteredList.data) {
      expect(row.demoString?.toUpperCase()).toContain(group)
    }

    // 分页：pageSize=1 → 第一页 1 行
    const paged = await api.root('POST', api.apiPath('/app/demo/list'), {
      filters: [{ field: 'demoString', op: 'like', value: group }],
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 1 },
    })
    expectOk(paged, 'demo list paged')
    const pagedList = bodyOf<DemoListData>(paged).data
    expect(pagedList.data).toHaveLength(1)
    expect(pagedList.total).toBeGreaterThanOrEqual(3)
  })

  it('delete → 软删进回收站（sys_deleted 快照）+ read 404', async () => {
    const createRes = await api.root('POST', api.apiPath('/app/demo'), demoPayload(`${group}-${seed8}-D1`))
    expectOk(createRes, 'demo create')
    const id = bodyOf<DemoRow>(createRes).data.id

    const deleteRes = await api.root('DELETE', api.apiPath(`/app/demo/${id}`))
    expectOk(deleteRes, 'demo delete')

    const readRes = await api.root('GET', api.apiPath(`/app/demo/${id}`))
    expect(bodyOf(readRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    // 软删快照行（B9 回收站）：deleted_id + 模型名 + deleted_by
    const deletedRows: Array<{ deleted_id: string, model_name: string, deleted_by: string }>
      = await api.pgDataSource.query(
        'SELECT deleted_id, model_name, deleted_by FROM sys_deleted WHERE deleted_id = $1',
        [id],
      )
    expect(deletedRows).toHaveLength(1)
    expect(deletedRows[0].model_name).toBe(WalnutModelName.APP_DEMO)
    expect(deletedRows[0].deleted_by).toBe(userId)
  })

  it('deleteMany → 批量软删，逐行消失', async () => {
    const ids: string[] = []
    for (const tag of ['M1', 'M2']) {
      const res = await api.root('POST', api.apiPath('/app/demo'), demoPayload(`${group}-${seed8}-${tag}`))
      expectOk(res, `demo create ${tag}`)
      ids.push(bodyOf<DemoRow>(res).data.id)
    }

    const deleteRes = await api.root('DELETE', api.apiPath(`/app/demo/deleteMany/${ids.join(',')}`))
    expectOk(deleteRes, 'demo deleteMany')
    expect(bodyOf<DemoRow[]>(deleteRes).data).toHaveLength(2)

    for (const id of ids) {
      const readRes = await api.root('GET', api.apiPath(`/app/demo/${id}`))
      expect(bodyOf(readRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
    }
  })

  it('校验失败 → 40099（forbidNonWhitelisted 剔除未知字段 / IsUppercase 拒小写）', async () => {
    const unknownField = await api.root('POST', api.apiPath('/app/demo'), {
      ...demoPayload(`${group}-${seed8}-V1`),
      notAField: 'boom',
    })
    expect(bodyOf(unknownField).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const lowercase = await api.root('POST', api.apiPath('/app/demo'), demoPayload(`api-demo-${seed8}-lower`))
    expect(bodyOf(lowercase).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('未登录 → 40101（JwtAccessGuard 拦在签名/权限之前）', async () => {
    const res = await api.anon('POST', api.apiPath('/app/demo'), demoPayload(`${group}-${seed8}-ANON`))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })
})

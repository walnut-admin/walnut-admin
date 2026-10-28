import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * D 段：`system/log/operate`（真实 HTTP 全链）—— 日志行由带 @WalnutAdminDecoratorOperateLog
 * 的真实写操作自然产生：`system/dict/type` 的 create（CRUD 装饰器自带操作日志）与
 * update（pg-base.repository.update 写 ALS snapshotBefore/After → 拦截器快照列）。
 *
 * 覆盖：list（deviceId 过滤 + 分页 + 行字段面）/ read（Safe DTO 无快照列）/
 * `:id/snapshot`（ALS 快照两腿：before.name ≠ after.name）/ `:id/device`（deviceId
 * 业务键反查 sys_device 组装回嵌套）+ 不存在 id 的 read/snapshot 40401。
 *
 * 拦截器落库是 `void insertToLogOperate(...)` 的 fire-and-forget —— 断言一律带轮询。
 * 装饰器入参无 operateType（CRUD update 只传 title/action）→ operation 列空（钉现状）。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LogOperateRow {
  id: string
  title?: string
  actionType?: string
  method?: string
  url?: string
  statusCode?: number
  requestData?: Record<string, unknown>
  responseData?: Record<string, unknown>
  durationMs?: number
  operation?: string | null
  userId?: string | null
  userName?: string | null
  deviceId?: string
  success?: boolean
  os?: string
  browser?: string
  snapshotBefore?: unknown
  snapshotAfter?: unknown
}

interface LogListData {
  data: LogOperateRow[]
  total: number
}

describe('D 段：system/log/operate list/read/snapshot/device（真实写操作自然产日志）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  const typePrefix = `log-operate-${seed8}`
  /** 唯一检索标记（requestData 里的 dict name 带上） */
  const marker = `log-op-marker-${seed8}`
  let fixture: WalnutRootUserFixture | null = null
  /** 本轮 dict 行 id（SQL 直删清场，不走 HTTP delete 免得再产日志/快照） */
  const dictTypeIds: string[] = []

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `log-operate-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // 日志生产者①：dictType create（CRUD create 自带操作日志，快照列为空）
    const createRes = await api.root('POST', api.apiPath('/system/dict/type'), {
      type: `${typePrefix}-t1`,
      name: `dict-${marker}-create`,
      status: true,
      description: 'log operate spec',
    })
    expectOk(createRes, 'dict type create (log producer)')
    dictTypeIds.push(bodyOf<{ id: string }>(createRes).data.id)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_dict_type WHERE type LIKE $1', [`${typePrefix}%`])
      // 本设备产生的操作日志行整体清（本文件的 device id 全仓唯一）
      await api.pgDataSource.query('DELETE FROM sys_log_operate WHERE device_id = $1', [api.deviceId])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  /** 日志行 fire-and-forget 落库 → 轮询 list 直到命中本标记 */
  async function waitForOperateLogRow(substring: string): Promise<LogOperateRow> {
    const deadline = Date.now() + 8000
    let last: LogOperateRow[] = []
    while (Date.now() < deadline) {
      const res = await api.root('POST', api.apiPath('/system/log/operate/list'), {
        query: { deviceId: api.deviceId },
        sort: [{ field: 'createdAt', order: 'descend', priority: 1 }],
        page: { page: 1, pageSize: 50 },
      })
      expectOk(res, 'log operate list (poll)')
      const list = bodyOf<LogListData>(res).data
      last = list.data
      const hit = list.data.find(row => JSON.stringify(row.requestData ?? {}).includes(substring))
      if (hit !== undefined) {
        return hit
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`[log-operate] row with marker "${substring}" not found; saw ${last.length} rows for this device`)
  }

  it('update（真实写操作）→ 产 UPDATE 日志行：字段面齐 + 快照腿 ALS 双值', async () => {
    // 日志生产者②：dictType update（pg-base update 写 ALS 快照 → 拦截器落 snapshot 列）
    const updateRes = await api.root('PUT', api.apiPath(`/system/dict/type/${dictTypeIds[0]}`), {
      type: `${typePrefix}-t1`,
      name: `dict-${marker}-updated`,
      status: false,
      description: 'log operate spec updated',
    })
    expectOk(updateRes, 'dict type update (log producer)')

    const updateRow = await waitForOperateLogRow(`${marker}-updated`)
    expect(updateRow.id).toMatch(UUID_RE)
    expect(updateRow.title).toBe('字典类型')
    expect(updateRow.actionType).toBe('UPDATE')
    expect(updateRow.operation).toBeNull()
    expect(updateRow.method).toBe('PUT')
    expect(updateRow.url).toContain('/system/dict/type/')
    expect(updateRow.statusCode).toBe(200)
    expect(updateRow.success).toBe(true)
    expect(updateRow.userId).toBe(fixture!.userId)
    expect(updateRow.userName).toBe(fixture!.userName)
    expect(updateRow.deviceId).toBe(api.deviceId)
    expect(typeof updateRow.durationMs).toBe('number')
    expect(updateRow.os).toMatch(/^Windows/)
    expect(updateRow.browser).toMatch(/^Chrome/)
    expect(updateRow.requestData).toMatchObject({ name: `dict-${marker}-updated` })
    // 请求体在 jsonb 里；响应壳 msg 已翻译直写
    expect(updateRow.responseData).toBeTruthy()

    // Safe 出参不带快照列（snapshot 走专属端点）
    expect(updateRow.snapshotBefore).toBeUndefined()
    expect(updateRow.snapshotAfter).toBeUndefined()
  })

  it('snapshot 端点 → ALS 快照两腿（before/after 的 name 翻转）', async () => {
    const updateRow = await waitForOperateLogRow(`${marker}-updated`)

    const res = await api.root('GET', api.apiPath(`/system/log/operate/${updateRow.id}/snapshot`))
    expectOk(res, 'log operate snapshot')

    const data = bodyOf<{ snapshotBefore: { name?: string }, snapshotAfter: { name?: string } }>(res).data
    expect(data.snapshotBefore.name).toBe(`dict-${marker}-create`)
    expect(data.snapshotAfter.name).toBe(`dict-${marker}-updated`)
  })

  it('device 端点 → deviceId 业务键反查 sys_device（组装回嵌套形态）', async () => {
    const updateRow = await waitForOperateLogRow(`${marker}-updated`)

    const res = await api.root('GET', api.apiPath(`/system/log/operate/${updateRow.id}/device`))
    expectOk(res, 'log operate device')

    const data = bodyOf<{ deviceId?: string, deviceName?: string, sr?: unknown, vp?: unknown }>(res).data
    expect(data.deviceId).toBe(api.deviceId)
    expect(typeof data.deviceName).toBe('string')
    expect(data.sr).toBeTruthy()
    expect(data.vp).toBeTruthy()
  })

  it('read → Safe DTO（无快照列）；不存在 id → 40401（read 与 snapshot 同型）', async () => {
    const updateRow = await waitForOperateLogRow(`${marker}-updated`)

    const readRes = await api.root('GET', api.apiPath(`/system/log/operate/${updateRow.id}`))
    expectOk(readRes, 'log operate read')
    const row = bodyOf<LogOperateRow>(readRes).data
    expect(row.id).toBe(updateRow.id)
    expect(row.title).toBe('字典类型')
    expect(row.snapshotBefore).toBeUndefined()

    const missing = await api.root('GET', api.apiPath(`/system/log/operate/${randomUUID()}`))
    expect(bodyOf(missing).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const missingSnapshot = await api.root('GET', api.apiPath(`/system/log/operate/${randomUUID()}/snapshot`))
    expect(bodyOf(missingSnapshot).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  })

  it('list → deviceId 过滤命中本轮行 + 分页生效；本轮 create 行也在（actionType 无快照）', async () => {
    const createRow = await waitForOperateLogRow(`${marker}-create`)
    // create 行：actionType CREATE、快照列空值（create 无 ALS 快照）
    expect(createRow.actionType).toBe('CREATE')

    const res = await api.root('POST', api.apiPath('/system/log/operate/list'), {
      query: { deviceId: api.deviceId },
      sort: [{ field: 'createdAt', order: 'descend', priority: 1 }],
      page: { page: 1, pageSize: 1 },
    })
    expectOk(res, 'log operate list paged')
    const list = bodyOf<LogListData>(res).data
    expect(list.total).toBeGreaterThanOrEqual(2)
    expect(list.data).toHaveLength(1)
  })
})

import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import * as opaque from '@serenity-kit/opaque'
import { AppTechRedisService } from '@walnut-server/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * D 段：`system/log/auth`（真实 HTTP 全链）—— 日志行由真实登录链自然产生：
 *
 * - 成功行：beforeAll 的 opaque HTTP 登录（login/finish 挂 @WalnutAdminDecoratorAuthLog，
 *   identifier 由 opaque strategy 写 request）；
 * - 失败行：login/start 用未知 userName（startLogin InvalidCredential → catch 落
 *   success=false 的 OPAQUE 日志 → 40103）；
 *
 * 覆盖：list（deviceId 过滤轮询 + type 数组过滤 + 分页）/ 行字段面（成功行 userId
 * 非空、失败行 userId 为 null）/ delete + deleteMany（软删 → sys_deleted 快照，
 * 清场一并收）/ 不存在 id → 40401。
 *
 * 拦截器/异常路径落库均为 `void recordAuth(...)` fire-and-forget —— 断言带轮询。
 */

interface LogAuthRow {
  id: string
  ip?: string
  os?: string
  browser?: string
  userId?: string | null
  userName?: string | null
  identifier?: string
  success?: boolean
  msg?: string
  type?: string
  deviceId?: string
}

interface LogAuthListData {
  data: LogAuthRow[]
  total: number
}

describe('D 段：system/log/auth list/delete/deleteMany（真实登录链自然产日志）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  /** 失败登录用的未知用户名（identifier 检索标记，同时是风险键清理片段） */
  const unknownUserName = `log-auth-unknown-${seed8}`
  let fixture: WalnutRootUserFixture | null = null

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `log-auth-${seed8}`)

    // 成功行生产者：真实 opaque HTTP 登录
    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    await api.seedMfaVerifiedCache(fixture.userId)

    // 失败行生产者：未知 userName 的 login/start（受控 40103）—— login/start 是
    // JwtFree + Sign 生效：先 setAuth(null) 回单因子（挂着登录态会签双因子被 40112 拦）
    api.setAuth(null)
    const { startLoginRequest } = opaque.client.startLogin({ password: 'whatever-Not-A-Password' })
    const failRes = await api.anon('POST', api.apiPath('/auth/opaque/user/login/start'), {
      userName: unknownUserName,
      start: startLoginRequest,
    })
    expect(bodyOf(failRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_CREDENTIALS)

    api.setAuth(tokens)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      // 软删日志产生的回收站快照一并清（deleted_id = 被删日志行 id）
      const deletedIds: Array<{ deleted_id: string }> = await api.pgDataSource.query(
        'SELECT deleted_id FROM sys_deleted WHERE model_name = $1 AND content::text LIKE $2',
        ['SysLogAuth', `%${seed8}%`],
      )
      if (deletedIds.length > 0) {
        await api.pgDataSource.query(
          'DELETE FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])',
          [deletedIds.map(i => i.deleted_id)],
        )
      }
      // 本设备产生的 auth 日志行整体清
      await api.pgDataSource.query('DELETE FROM sys_log_auth WHERE device_id = $1', [api.deviceId])
      // 失败登录风险键（裸 Redis 键，命名带 identifier —— 按片段 SCAN 清）
      const redis = app.get(AppTechRedisService).getClient()
      const riskKeys: string[] = []
      for await (const key of redis.scanIterator({ MATCH: `*${unknownUserName}*`, COUNT: 200 })) {
        riskKeys.push(...key)
      }
      if (riskKeys.length > 0) {
        await redis.del(riskKeys)
      }
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId, unknownUserName)
    }
    await app.close()
  })

  async function listByDevice(pageSize = 50): Promise<LogAuthListData> {
    const res = await api.root('POST', api.apiPath('/system/log/auth/list'), {
      filters: [{ field: 'deviceId', op: 'like', value: api.deviceId }],
      sort: [{ field: 'authenticatedAt', order: 'descend', priority: 1 }],
      page: { page: 1, pageSize },
    })
    expectOk(res, 'log auth list')
    return bodyOf<LogAuthListData>(res).data
  }

  /** fire-and-forget 落库 → 轮询直到成功行 + 失败行都出现 */
  async function waitForBothRows(): Promise<{ successRow: LogAuthRow, failRow: LogAuthRow }> {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const list = await listByDevice()
      const successRow = list.data.find(row => row.success === true && row.identifier === fixture!.userName)
      const failRow = list.data.find(row => row.success === false && row.identifier === unknownUserName)
      if (successRow !== undefined && failRow !== undefined) {
        return { successRow, failRow }
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('[log-auth] success/fail rows not found within timeout')
  }

  it('list → 成功行（userId/userName/type=opaque）+ 失败行（userId null，identifier=未知名）字段面', async () => {
    const { successRow, failRow } = await waitForBothRows()

    expect(successRow.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(successRow.userId).toBe(fixture!.userId)
    expect(successRow.userName).toBe(fixture!.userName)
    expect(successRow.type).toBe('opaque')
    expect(successRow.deviceId).toBe(api.deviceId)
    expect(successRow.ip).toBeTruthy()
    expect(successRow.os).toMatch(/^Windows/)
    expect(successRow.browser).toMatch(/^Chrome/)

    expect(failRow.userId).toBeNull()
    expect(failRow.userName).toBeNull()
    expect(failRow.type).toBe('opaque')
    // msg 是 i18n 翻译后的受控文案（response.40103）
    expect(typeof failRow.msg).toBe('string')
    expect(failRow.msg!.length).toBeGreaterThan(0)
  })

  it('list 过滤：type 数组 [opaque] 命中、type [qrcode] 空命中；分页 pageSize=1', async () => {
    await waitForBothRows()

    const opaqueOnly = await api.root('POST', api.apiPath('/system/log/auth/list'), {
      filters: [{ field: 'deviceId', op: 'like', value: api.deviceId }, { field: 'type', op: 'in', value: ['opaque'] }],
      page: { page: 1, pageSize: 50 },
    })
    expectOk(opaqueOnly, 'log auth list filter opaque')
    const opaqueList = bodyOf<LogAuthListData>(opaqueOnly).data
    expect(opaqueList.total).toBeGreaterThanOrEqual(2)
    for (const row of opaqueList.data) {
      expect(row.type).toBe('opaque')
    }

    const qrcodeOnly = await api.root('POST', api.apiPath('/system/log/auth/list'), {
      filters: [{ field: 'deviceId', op: 'like', value: api.deviceId }, { field: 'type', op: 'in', value: ['qrcode'] }],
      page: { page: 1, pageSize: 50 },
    })
    expectOk(qrcodeOnly, 'log auth list filter qrcode')
    expect(bodyOf<LogAuthListData>(qrcodeOnly).data.total).toBe(0)

    const paged = await listByDevice(1)
    expect(paged.total).toBeGreaterThanOrEqual(2)
    expect(paged.data).toHaveLength(1)
  })

  it('delete → 软删（sys_deleted 快照）+ deleteMany → 批量消失；不存在 id → 40401', async () => {
    const { successRow, failRow } = await waitForBothRows()

    const deleteRes = await api.root('DELETE', api.apiPath(`/system/log/auth/${failRow.id}`))
    expectOk(deleteRes, 'log auth delete')
    expect(bodyOf<{ id?: string }>(deleteRes).data.id).toBe(failRow.id)

    const goneRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_log_auth WHERE id = $1',
      [failRow.id],
    )
    expect(goneRows[0].c).toBe(0)
    // 软删快照在回收站
    const snapshotRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_deleted WHERE deleted_id = $1 AND model_name = $2',
      [failRow.id, 'SysLogAuth'],
    )
    expect(snapshotRows[0].c).toBe(1)

    const missing = await api.root('DELETE', api.apiPath(`/system/log/auth/${failRow.id}`))
    expect(bodyOf(missing).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const deleteManyRes = await api.root('DELETE', api.apiPath(`/system/log/auth/deleteMany/${successRow.id}`))
    expectOk(deleteManyRes, 'log auth deleteMany')
    expect(bodyOf<Array<{ id?: string }>>(deleteManyRes).data[0].id).toBe(successRow.id)

    const remainRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_log_auth WHERE id = $1',
      [successRow.id],
    )
    expect(remainRows[0].c).toBe(0)
  })
})

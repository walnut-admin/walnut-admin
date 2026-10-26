import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * B 段：`GET /app/error/:code` 错误通道冒烟 —— controller 的 ErrorMap 按 code 抛
 * 对应 WalnutAdminException，全局异常过滤器统一回 HTTP 200 + body.code。
 *
 * 抽 4 个代表性 code：400 校验（40000）/ 401 认证（40103）/ 403（40300）/ 500（50000）
 * —— 这四个的 ErrorMap 异常与 contract 错误码一一对齐，断言 body.code 即路由 code。
 * （401xx 段的 ErrorMap 映射与 contract 错误码存在历史错位，如 40112 挂的是
 * CapInteractionRequired（真实码 40116）—— 非迁移回归，不在本段断言范围。）
 *
 * 守卫口径：DevOnly guard 只看 NODE_ENV=development（集成测试 setup-env 固定注入）；
 * 类级 HasRole([root,developer]) + HasPermission(app:error:test) 由 root 短路放行。
 */

describe('B 段：app/error 错误通道冒烟（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `error-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('40000 → 校验错误通道（WalnutAdminExceptionBadRequest）', async () => {
    const res = await api.root('GET', api.apiPath('/app/error/40000'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('40103 → 认证错误通道（WalnutAdminExceptionInvalidCredential）', async () => {
    const res = await api.root('GET', api.apiPath('/app/error/40103'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_CREDENTIALS)
  })

  it('40300 → 禁止通道（WalnutAdminExceptionForbidden）', async () => {
    const res = await api.root('GET', api.apiPath('/app/error/40300'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.FORBIDDEN)
  })

  it('50000 → 服务器错误通道（WalnutAdminExceptionInternalServerError）', async () => {
    const res = await api.root('GET', api.apiPath('/app/error/50000'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR)
  })

  it('枚举外 code → 40099（WalnutAdminPipeParamEnum 参数 pipe 拒绝）', async () => {
    const res = await api.root('GET', api.apiPath('/app/error/99999'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

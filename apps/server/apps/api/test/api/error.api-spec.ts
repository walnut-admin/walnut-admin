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
 * P2-7 修复后（2026-10-28）：ErrorMap 的 40112-40117 已与 contract 错误码逐个对齐
 * （40112 InvalidSignature / 40113 ExpiredSignature / 40114 MfaRequired /
 * 40115 MfaVerifyFailed / 40116 CapInteractionRequired / 40117 CapRefreshRequired），
 * 本文件对 **ErrorMap 全项** 断言 body.code 即路由 code（不再绕开错位项）。
 *
 * 守卫口径：DevOnly guard 只看 NODE_ENV=development（集成测试 setup-env 固定注入）；
 * 类级 HasRole([root,developer]) + HasPermission(app:error:test) 由 root 短路放行。
 */

/** ErrorMap 全项（与 error.controller.ts 的映射键逐一对应） */
const ERROR_MAP_CODES = [
  40000,
  40001,
  40002,
  40011,
  40012,
  40099,
  40100,
  40101,
  40102,
  40103,
  40104,
  40105,
  40106,
  40107,
  40108,
  40109,
  40110,
  40111,
  40112,
  40113,
  40114,
  40115,
  40116,
  40117,
  40118,
  40119,
  40300,
  40400,
  40401,
  40600,
  40601,
  40602,
  40603,
  40604,
  40605,
  40606,
  40607,
  40666,
  40800,
  50000,
  50001,
  50300,
  50301,
  50302,
  50400,
  50500,
] as const

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

  it('ErrorMap 全项 → body.code 与路由 code 逐一相等（P2-7 对齐后）', async () => {
    for (const code of ERROR_MAP_CODES) {
      const res = await api.root('GET', api.apiPath(`/app/error/${code}`))
      expect(bodyOf(res).code, `error channel ${code}`).toBe(code)
    }
  })

  it('枚举外 code → 40099（WalnutAdminPipeParamEnum 参数 pipe 拒绝）', async () => {
    const res = await api.root('GET', api.apiPath('/app/error/99999'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

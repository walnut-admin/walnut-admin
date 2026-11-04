import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutAuthTokens } from '../../helpers/api-client'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'

/**
 * B 段：`app/health` 五端点 + 根 controller（`/`、`/auth`、`/deps`）冒烟。
 *
 * - **postgres 端点是 PG 迁移回归的直接验证**（terminus pingCheck 打真实命名连接），
 *   断言 up；memory-heap/rss/disk 依赖宿主资源水位（阈值 200MB/75%），断言「受控二值」：
 *   达标 20000（出参 `{ <endpoint>: { status: 'up' } }`）或超阈 50000（terminus 503 被
 *   异常过滤器兜底映射 50000，非 50300 —— 钉现状）。出参形状按本仓库 terminus 版本实测：
 *   只有 indicator 键，无 `{ status, info, details }` 外壳。
 * - P3-22：disk 检查路径按 `process.platform` 取根（Windows `C:/`、类 Unix `/`），
 *   spec 在 Windows 开发机与 Linux CI 上跑的都是存在路径，不再有「非 Windows 恒 50000」
 *   的失败面；平台分支由 `health.controller.spec.ts` 单测钉死。
 * - network 端点外连 baidu.com，外部依赖不进回归（ENDPOINTS.md §6 登记）。
 * - 根 controller：`/`（DeviceFree+JwtFree，Sign 仍生效）匿名可达；`/auth`（仅
 *   DeviceFree）与 `/deps` 登录态才可达。注意 `anon()` 在 `setAuth()` 之后签的是双因子
 *   （无 Authorization 头）—— 对 JwtFree+Sign 生效的 `/` 会 40112，因此本 spec 的匿名
 *   断言先 `setAuth(null)` 回到单因子再发。
 */

interface TerminusData {
  [indicator: string]: { status?: string } | undefined
}

describe('B 段：app/health 五端点 + 根 controller（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  let tokens: WalnutAuthTokens | null = null

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `health-${seed8}`)

    tokens = await performHttpOpaqueLogin(api, app, fixture)
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

  it('GET /app/health/postgres → 20000 且 postgres status=up（迁移回归直接验证）', async () => {
    const res = await api.root('GET', api.apiPath('/app/health/postgres'))
    expectOk(res, 'health postgres')

    const data = bodyOf<TerminusData>(res).data
    expect(data.postgres?.status).toBe('up')
  })

  it('memory-heap / memory-rss / disk → 受控二值：20000（indicator status up/down）或超阈 50000', async () => {
    for (const endpoint of ['memory-heap', 'memory-rss', 'disk'] as const) {
      const res = await api.root('GET', api.apiPath(`/app/health/${endpoint}`))
      const code = bodyOf<TerminusData>(res).code

      if (code === WalnutAdminConstAppResponseCode.SUCCESS) {
        // 宿主水位依赖运行环境（vitest worker 常驻 >200MB 时 down）—— 本仓库 terminus
        // 版本不抛 503，而是 20000 + indicator status 'down'（钉现状）
        const status = bodyOf<TerminusData>(res).data[endpoint]?.status
        expect(status === 'up' || status === 'down').toBe(true)
      }
      else {
        // 兜底通道：异常过滤器把非 HttpException/503 映射为 50000（非 50300 —— 钉现状）
        expect(code).toBe(WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR)
      }
    }
  })

  it('根 controller `/`：匿名（单因子 Sign 链）→ 20000 i18n 问候；缺签名头 → 40112', async () => {
    // `/` 是 JwtFree + Sign 生效：anon() 必须回到未登录单因子（setAuth 态的双因子会 40112）
    api.setAuth(null)
    const res = await api.anon('GET', api.apiPath('/'))
    expectOk(res, 'root hello')
    expect(bodyOf<string>(res).data).toBeTypeOf('string')
    expect((bodyOf<string>(res).data).length).toBeGreaterThan(0)

    const unsignedRes = await api.unsigned('GET', api.apiPath('/'))
    expect(bodyOf(unsignedRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)

    api.setAuth(tokens)
  })

  it('根 controller `/auth`：登录态 → 20000；匿名 → 40101（JWT guard 拦在 Sign 之前）', async () => {
    const res = await api.root('GET', api.apiPath('/auth'))
    expectOk(res, 'root auth')
    expect(bodyOf<string>(res).data).toBeTypeOf('string')

    api.setAuth(null)
    const anonRes = await api.anon('GET', api.apiPath('/auth'))
    expect(bodyOf(anonRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
    api.setAuth(tokens)
  })

  it('根 controller `/deps`：登录态 → 20000 依赖清单非空（返回 package.json 依赖，非连通状态）；匿名 → 40101', async () => {
    const res = await api.root('GET', api.apiPath('/deps'))
    expectOk(res, 'root deps')

    const data = bodyOf<{ dependencies: Record<string, string>, devDependencies: Record<string, string> }>(res).data
    expect(Object.keys(data.dependencies).length).toBeGreaterThan(0)
    expect(Object.keys(data.devDependencies).length).toBeGreaterThan(0)

    api.setAuth(null)
    const anonRes = await api.anon('GET', api.apiPath('/deps'))
    expect(bodyOf(anonRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
    api.setAuth(tokens)
  })
})

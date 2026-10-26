import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import * as opaque from '@serenity-kit/opaque'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * D 段：`auth/opaque` 管理端 + me 通道改密（真实 opaque 客户端两步，真实 HTTP 全链）：
 *
 * - me 通道 `change-password/{start,finish}`：自改密闭环 —— start 拿服务端
 *   registrationResponse → 客户端 finishRegistration 出新 record → finish 落库
 *   （identity value/valueHash 整体替换）+ 触发 security-policy 全设备 RT 吊销
 *   （updatePass）；旧密码登录链 finishLogin 失败、新密码登录成功；
 * - 管理端 `admin/password/update/{start,finish}`：root 给目标用户改密（同一 opaque
 *   客户端两步，body 只带目标 userId），target 旧会话全吊销；
 * - 管理端 `admin/password/clear`：删 password identity（幂等：无行再删仍 20000 true，
 *   C 段 user spec 已钉语义）—— 清掉后 login/start 直接 InvalidCredential（40103，
 *   password identity 缺失分支）。
 *
 * 定位键差异钉现状：me 通道从 token 取 userName；管理端按 user 主键 id（uuid）定位
 * （B7a 定稿，PG 侧唯一标识是 id）。
 */

/** opaque 客户端 login/start 的首步状态（类型从同库 startLogin 返回值推导，避免碰包内导出面） */
type OpaqueClientLoginState = ReturnType<typeof opaque.client.startLogin>['clientLoginState']

interface LoginStartResult {
  clientLoginState: OpaqueClientLoginState
  loginResponse: string
}

/** 独立 HTTP opaque 登录（返回首步状态供调用方判定 finishLogin 成败） */
async function startHttpLogin(
  api: WalnutApiClient,
  app: NestExpressApplication,
  userName: string,
  password: string,
): Promise<LoginStartResult | null> {
  const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password })
  const startRes = await api.anon('POST', api.apiPath('/auth/opaque/user/login/start'), {
    userName,
    start: startLoginRequest,
  })
  if (bodyOf(startRes).code !== 20000) {
    throw new Error(`[opaque-admin] login/start failed: ${JSON.stringify(bodyOf(startRes))}`)
  }
  return { clientLoginState, loginResponse: bodyOf<string>(startRes).data }
}

/** 完成登录（consume finishLogin 结果）—— 密码不对时 opaque 客户端返回 null */
function finishClientLogin(
  app: NestExpressApplication,
  login: LoginStartResult,
  userName: string,
  password: string,
): string | null {
  const appName = app.get(ConfigService).get<string>('app.name')!
  const result = opaque.client.finishLogin({
    clientLoginState: login.clientLoginState,
    loginResponse: login.loginResponse,
    password,
    identifiers: { client: userName, server: appName },
  })
  return result === null || result === undefined ? null : result.finishLoginRequest
}

describe('D 段：opaque me 通道改密 + admin 管理端 password update/clear（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  /** 目标用户（管理端操作对象）+ 自有客户端（me 通道改密载体） */
  let apiTarget: WalnutApiClient
  let fixture: WalnutRootUserFixture | null = null
  let fixtureTarget: WalnutRootUserFixture | null = null

  const seed8 = randomUUID().slice(0, 8)
  /** 目标用户当前密码（me → P1；admin 改 → P2） */
  let targetPassword = ''

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    apiTarget = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `opaque-admin-${seed8}`)
    fixtureTarget = await registerRootUserFixture(app, api.pgDataSource, `opaque-target-${seed8}`)
    targetPassword = fixtureTarget.password

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // 目标用户走真实 HTTP 登录（自有设备 + RT 行，后续吊销断言的标本）
    const tokensTarget = await performHttpOpaqueLogin(apiTarget, app, fixtureTarget)
    apiTarget.setAuth(tokensTarget)
    await apiTarget.seedMfaVerifiedCache(fixtureTarget.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null && fixtureTarget !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user_identity WHERE user_id = $1', [fixtureTarget.userId])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = ANY($1::uuid[])', [[fixture.userId, fixtureTarget.userId]])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [[api.deviceId, apiTarget.deviceId]])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, apiTarget.deviceId, fixture.userId, fixtureTarget.userId)
    }
    await app.close()
  })

  async function readPasswordIdentity(userId: string): Promise<{ value: string, value_hash: string } | null> {
    const rows: Array<{ value: string, value_hash: string }> = await api.pgDataSource.query(
      'SELECT value, value_hash FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [userId, 'password', 'login'],
    )
    return rows[0] ?? null
  }

  it('me 通道 change-password：start → finish（真实 opaque 两步）→ identity 替换 + 全设备 RT 吊销（updatePass）', async () => {
    const identityBefore = await readPasswordIdentity(fixtureTarget!.userId)
    expect(identityBefore).not.toBeNull()
    // step 1 —— 客户端为新密码起注册流，服务端出 registrationResponse
    const newPassword = `New-${randomUUID().slice(0, 12)}#73`
    const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password: newPassword })
    const startRes = await apiTarget.root('POST', apiTarget.apiPath('/auth/opaque/user/change-password/start'), {
      start: registrationRequest,
    })
    expectOk(startRes, 'change-password start')
    const registrationResponse = bodyOf<string>(startRes).data

    // step 2 —— 客户端 finalize 出 record，服务端落 identity + 吊销全设备 RT
    const appName = app.get(ConfigService).get<string>('app.name')!
    const { registrationRecord } = opaque.client.finishRegistration({
      clientRegistrationState,
      registrationResponse,
      password: newPassword,
      identifiers: { client: fixtureTarget!.userName, server: appName },
    })
    const finishRes = await apiTarget.root('POST', apiTarget.apiPath('/auth/opaque/user/change-password/finish'), {
      finish: registrationRecord,
    })
    expectOk(finishRes, 'change-password finish')
    expect(bodyOf<boolean>(finishRes).data).toBe(true)

    // identity 被替换（value/valueHash 都是 opaque record，逐字节变化）
    const identityAfter = await readPasswordIdentity(fixtureTarget!.userId)
    expect(identityAfter!.value).not.toBe(identityBefore!.value)
    expect(identityAfter!.value_hash).not.toBe(identityBefore!.value_hash)

    // security-policy：目标用户全设备 RT 吊销（revokeReason=updatePass）
    const rtRows: Array<{ revoked: boolean, revoke_reason: string | null }> = await api.pgDataSource.query(
      'SELECT revoked, revoke_reason FROM auth_refresh_token WHERE user_id = $1',
      [fixtureTarget!.userId],
    )
    expect(rtRows.length).toBeGreaterThanOrEqual(1)
    for (const row of rtRows) {
      expect(row.revoked).toBe(true)
      expect(row.revoke_reason).toBe('updatePass')
    }

    targetPassword = newPassword
  })

  it('改密后：旧密码登录链 finishLogin 失败（opaque 客户端拒绝），新密码登录成功', async () => {
    const oldPassword = fixtureTarget!.password

    // login/start 是 JwtFree + Sign 生效：客户端挂着登录态会签双因子被 40112 拦 —— 先清
    apiTarget.setAuth(null)

    // 旧密码：server startLogin 正常（opaque 协议第一步与密码无关），客户端 finishLogin 校验失败
    // （start/finish 都走目标用户客户端 —— 服务端 opaque state 缓存按 userName+deviceId 键控）
    const oldLogin = await startHttpLogin(apiTarget, app, fixtureTarget!.userName, oldPassword)
    expect(oldLogin).not.toBeNull()
    expect(finishClientLogin(app, oldLogin!, fixtureTarget!.userName, oldPassword)).toBeNull()

    // 新密码：客户端 finish 通过 → login/finish 换发令牌
    const newLogin = await startHttpLogin(apiTarget, app, fixtureTarget!.userName, targetPassword)
    expect(newLogin).not.toBeNull()
    const finishRequest = finishClientLogin(app, newLogin!, fixtureTarget!.userName, targetPassword)
    expect(finishRequest).not.toBeNull()

    const finishRes = await apiTarget.anon('POST', apiTarget.apiPath('/auth/opaque/user/login/finish'), {
      userName: fixtureTarget!.userName,
      finish: finishRequest,
    })
    expectOk(finishRes, 'login with new password')
    expect(typeof bodyOf<{ accessToken: string }>(finishRes).data.accessToken).toBe('string')
  })

  it('admin password/update：root 给目标用户改密（按 id 定位）→ identity 再替换 + RT 再吊销', async () => {
    const identityBefore = await readPasswordIdentity(fixtureTarget!.userId)
    expect(identityBefore).not.toBeNull()

    const adminPassword = `Admin-${randomUUID().slice(0, 12)}#81`
    const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password: adminPassword })
    const startRes = await api.root('POST', api.apiPath('/auth/opaque/admin/password/update/start'), {
      id: fixtureTarget!.userId,
      start: registrationRequest,
    })
    expectOk(startRes, 'admin password update start')
    const registrationResponse = bodyOf<string>(startRes).data

    const appName = app.get(ConfigService).get<string>('app.name')!
    const { registrationRecord } = opaque.client.finishRegistration({
      clientRegistrationState,
      registrationResponse,
      password: adminPassword,
      identifiers: { client: fixtureTarget!.userName, server: appName },
    })
    const finishRes = await api.root('POST', api.apiPath('/auth/opaque/admin/password/update/finish'), {
      id: fixtureTarget!.userId,
      finish: registrationRecord,
    })
    expectOk(finishRes, 'admin password update finish')
    expect(bodyOf<boolean>(finishRes).data).toBe(true)

    const identityAfter = await readPasswordIdentity(fixtureTarget!.userId)
    expect(identityAfter!.value).not.toBe(identityBefore!.value)

    const rtRows: Array<{ revoked: boolean, revoke_reason: string | null }> = await api.pgDataSource.query(
      'SELECT revoked, revoke_reason FROM auth_refresh_token WHERE user_id = $1',
      [fixtureTarget!.userId],
    )
    for (const row of rtRows) {
      expect(row.revoked).toBe(true)
    }

    // 管理端定位键错误路径：不存在的 userId → 40000
    const badStart = await api.root('POST', api.apiPath('/auth/opaque/admin/password/update/start'), {
      id: randomUUID(),
      start: registrationRequest,
    })
    expect(bodyOf(badStart).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    targetPassword = adminPassword
  })

  it('admin password/clear → password identity 删除；幂等（无行再删恒 true）；清后 login/start → 40103', async () => {
    const clearRes = await api.root('POST', api.apiPath('/auth/opaque/admin/password/clear'), {
      id: fixtureTarget!.userId,
    })
    expectOk(clearRes, 'admin password clear')
    expect(bodyOf<boolean>(clearRes).data).toBe(true)
    expect(await readPasswordIdentity(fixtureTarget!.userId)).toBeNull()

    // 幂等：identity 已不存在仍返回 true（C 段 user spec 同语义）
    const reclearRes = await api.root('POST', api.apiPath('/auth/opaque/admin/password/clear'), {
      id: fixtureTarget!.userId,
    })
    expectOk(reclearRes, 'admin password clear again')
    expect(bodyOf<boolean>(reclearRes).data).toBe(true)

    // password identity 缺失 → login/start 直接 InvalidCredential
    // （注意 anon() 单因子：主/目标客户端此时都还挂着登录态 —— 双因子签名会被 40112 拦）
    api.setAuth(null)
    const { startLoginRequest } = opaque.client.startLogin({ password: targetPassword })
    const startRes = await api.anon('POST', api.apiPath('/auth/opaque/user/login/start'), {
      userName: fixtureTarget!.userName,
      start: startLoginRequest,
    })
    expect(bodyOf(startRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_CREDENTIALS)
  })

  it('login/client-error：上报恒 40103 InvalidCredential（E 段终审补漏）', async () => {
    const res = await api.anon('POST', api.apiPath('/auth/opaque/user/login/client-error'), {
      userName: fixtureTarget!.userName,
      clientError: 'passwordError',
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_CREDENTIALS)

    // clientError 枚举外 → 40099 校验拒绝
    const badRes = await api.anon('POST', api.apiPath('/auth/opaque/user/login/client-error'), {
      userName: fixtureTarget!.userName,
      clientError: 'not-a-real-error',
    })
    expect(bodyOf(badRes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

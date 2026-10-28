import type { NestExpressApplication } from '@nestjs/platform-express'
import type { DataSource } from 'typeorm'
import type { WalnutApiClient, WalnutAuthTokens } from './api-client'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import * as opaque from '@serenity-kit/opaque'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { Role } from '@walnut/contract'

import { AuthOpaqueCoreService } from '@/modules/auth/modules/opaque/core/opaque.core.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'

import { bodyOf } from './api-client'

/**
 * 真实 opaque 注册/登录助手（API 级测试）。
 *
 * 注册**不走 HTTP**：`/auth/opaque/user/register/{start,finish}` 的语义是已登录用户
 * 补挂口令（P1-14，2026-10-28：按 userId upsert password identity，不建用户）；测试
 * fixture 需要造新用户，因此走服务真实写腿：`SysUserSharedService.createForAuthUser`
 * 落 user + junction，再 `AuthOpaqueCoreService.finishRegister(userId, record)` 补挂
 * password identity（@serenity-kit/opaque 客户端流程，identifiers 双端一致，
 * serverSetup/app.name 与服务同源配置）。
 *
 * 登录**走 HTTP**：`POST /auth/opaque/user/login/start`（单因子签名）→ 客户端
 * `finishLogin` → `POST /auth/opaque/user/login/finish`（passport-local strategy 消费
 * `{userName, finish}`）→ 响应 `{accessToken, sessionKey}` + RT_JTI cookie。
 *
 * root 通路（ENDPOINTS.md 已核实）：permission.guard 对
 * `roleMode === 'combinable' && roleNames[0] === 'root'` 短路放行，无需造菜单/权限数据；
 * mfa.guard 对已登录非 visitor 用户强制 `mfa_setup = true`（AT payload 在登录时固化）
 * + 设备级 verified 缓存（由 api-client 的 `seedMfaVerifiedCache` 走真实缓存通道补）。
 */

/** B7c 同款：settings 缺省时 createForAuthUser 的 visitor 兜底 role uuid（junction FK 必须有该行） */
export const WALNUT_DEFAULT_VISITOR_ROLE_UUID = 'd6e8ca57-1faf-56d7-b090-9ff0c0b78ce6'

export interface WalnutRootUserFixture {
  userId: string
  userName: string
  password: string
  roleId: string
}

/**
 * 服务级注册一个 root 用户（opaque 真实注册链 + PG fixture：root 角色 Junction、
 * combinable role_mode、mfa_setup = true）。返回的凭证用于 HTTP 登录。
 */
export async function registerRootUserFixture(
  app: NestExpressApplication,
  pgDataSource: DataSource,
  userNamePrefix: string,
): Promise<WalnutRootUserFixture> {
  const configService = app.get(ConfigService)
  const opaqueCore = app.get(AuthOpaqueCoreService)
  const userShared = app.get(SysUserSharedService)

  const userName = `${userNamePrefix}-${randomUUID().slice(0, 8)}`
  const password = `Pwd-${randomUUID().slice(0, 12)}#42`

  // —— opaque 客户端注册流程（与服务真实用法同构：identifiers 双端一致）——
  const appName = configService.get<string>('app.name')!
  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password })
  const registrationResponse = await opaqueCore.startRegister(userName, registrationRequest)
  const { registrationRecord } = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
    identifiers: { client: userName, server: appName },
  })

  // createForAuthUser 会给 junction 写 visitor 兜底 role uuid —— 先确保该行存在，FK 才不炸；
  // 随后 finishRegister 按新 userId 补挂 password identity（P1-14 语义：不建用户）
  await pgDataSource.query(
    'INSERT INTO sys_role (id, role_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [WALNUT_DEFAULT_VISITOR_ROLE_UUID, `${userNamePrefix}-visitor-${randomUUID().slice(0, 8)}`],
  )
  const newUser = await userShared.createForAuthUser({ userName }, pgDataSource.manager)
  await opaqueCore.finishRegister(newUser.id, registrationRecord, pgDataSource.manager)

  const userId = newUser.id

  // —— root 角色（COMBINE 首角色短路）+ MFA setup（mfa.guard P5 看登录时固化的 AT payload）——
  // role_name 有唯一索引：上一轮异常退出可能残留 'root' 行，幂等复用（调用方 afterAll 按 id 清）
  const roleRows: Array<{ id: string }> = await pgDataSource.query(
    `WITH ins AS (
       INSERT INTO sys_role (role_name) VALUES ($1)
       ON CONFLICT (role_name) DO NOTHING
       RETURNING id
     )
     SELECT id FROM ins
     UNION ALL
     SELECT id FROM sys_role WHERE role_name = $1
     LIMIT 1`,
    [Role.ROOT],
  )
  const roleId = roleRows[0].id
  await pgDataSource.query(
    'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2)',
    [userId, roleId],
  )
  // 短路判据是 roleNames[0] === 'root'（COMBINE 模式取 roles_list 首位）——
  // finishRegister 已经挂了 visitor 兜底 junction 且排在前，只留 root 并把 current_role_id
  // 一并对齐，AT payload 才是 { roleMode: 'combinable', roleNames: ['root'] }
  await pgDataSource.query(
    'DELETE FROM sys_user_role WHERE user_id = $1 AND role_id <> $2',
    [userId, roleId],
  )
  await pgDataSource.query(
    'UPDATE sys_user SET mfa_setup = true, role_mode = $2, current_role_id = $3 WHERE id = $1',
    [userId, WalnutAdminConstRoleMode.COMBINE, roleId],
  )

  return { userId, userName, password, roleId }
}

/**
 * HTTP 真实 opaque 登录：login/start → 客户端 finishLogin → login/finish。
 * 请求都由 api-client 的 anon() 发出（单因子签名 + 引导期拿到的 cookie）。
 * 成功后调用方需把返回的 tokens `api.setAuth()`，并按需 `api.seedMfaVerifiedCache(userId)`。
 */
export async function performHttpOpaqueLogin(
  api: WalnutApiClient,
  app: NestExpressApplication,
  fixture: { userName: string, password: string, userId: string },
): Promise<WalnutAuthTokens> {
  const configService = app.get(ConfigService)
  const appName = configService.get<string>('app.name')!

  // 1. login/start
  const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password: fixture.password })
  const startRes = await api.anon('POST', api.apiPath('/auth/opaque/user/login/start'), {
    userName: fixture.userName,
    start: startLoginRequest,
  })
  expectLoginOk(bodyOf(startRes), 'login/start')
  const loginResponse = bodyOf<string>(startRes).data

  // 2. 客户端 finishLogin
  const loginResult = opaque.client.finishLogin({
    clientLoginState,
    loginResponse,
    password: fixture.password,
    identifiers: { client: fixture.userName, server: appName },
  })
  if (!loginResult) {
    throw new Error('[auth-login] opaque client finishLogin returned falsy')
  }

  // 3. login/finish（passport-local AuthOpaqueUserGuard 消费 userName/finish；
  //    签名仍为单因子 —— sign guard 在 jwt guard 之后跑，此时 req.user 还未挂）
  const finishRes = await api.anon('POST', api.apiPath('/auth/opaque/user/login/finish'), {
    userName: fixture.userName,
    finish: loginResult.finishLoginRequest,
  })
  expectLoginOk(bodyOf(finishRes), 'login/finish')

  const data = bodyOf<{ accessToken: string, sessionKey: string }>(finishRes).data
  return {
    userId: fixture.userId,
    userName: fixture.userName,
    accessToken: data.accessToken,
    sessionKey: data.sessionKey,
  }
}

function expectLoginOk(body: { code?: number }, what: string): void {
  if (body.code !== 20000) {
    throw new Error(`[auth-login] ${what} failed: body=${JSON.stringify(body)}`)
  }
}

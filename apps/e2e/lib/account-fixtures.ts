/**
 * 可登录的**非 root** 账号 fixture（Phase 3 模块 spec / auth 矩阵共用）。
 *
 * 为什么需要它：`POST /system/user` 只建账号与角色绑定，**不带口令**；而
 * `/auth/opaque/user/register/*` 的语义是「已登录用户补挂口令」（handler 读 `req.user`）——
 * 新账号在拿到口令前无法登录，是个鸡生蛋。服务端集成测试用 `AuthOpaqueCoreService` 直调
 * 绕开；E2E 面对真实进程，因此这里复刻**同一条 OPAQUE 注册链**：
 *
 * 1. 客户端 `startRegistration`；
 * 2. 用 `.env.stage` 的 `AUTH_OPAQUE_SECRET`（= 服务端 `jwt.opaque.secret`）与
 *    **userIdentifier = userName** 生成 `createRegistrationResponse`
 *    （与服务端 `startLogin` / `createRegistrationResponse` 的 userIdentifier 同源）；
 * 3. 客户端 `finishRegistration` 得到 registrationRecord；
 * 4. 按服务端 `AuthOpaqueCoreService.finishRegister` 的口径把 registrationRecord **明文**
 *    写入 `sys_user_identity`（type=password / purpose=login）。
 *
 * 之后所有用例都走**真实协议登录**（设备登记 → CAP → 签名握手 → OPAQUE），不伪造 AT / 会话。
 * 这与 prepare-db 的 `--admin --password` 是同一类 fixture：只补「管理端 API 没有的建号带口令
 * 通道」，不改变被测行为。
 */
import type { SystemUser } from '@walnut/api-types'
import { randomBytes } from 'node:crypto'
import * as opaque from '@serenity-kit/opaque'
import { readServerStageEnv } from '../scripts/env.ts'
import { E2ePreconditionError } from '../scripts/failure.ts'
import { trackDevice, uniqueLocalIp } from './device-fixtures.ts'
import { deleteUserByUserName, withPg } from './pg.ts'
import { WalnutProtocolClient } from './protocol/client.ts'
import { SystemRoutes } from './protocol/contract.ts'

export interface LoginableUser {
  userName: string
  password: string
  userId: string
}

/** 唯一账号名（同 user-crud 的 `e2e-<ts>-<rand>` 口径；user_name 无长度上限） */
export function uniqueUserName(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(3).toString('hex')}`
}

/**
 * 用 root 协议客户端建一个**可登录**的用户（指定角色）。
 *
 * 角色决定 `/auth/permissions` 的输出；调用方负责在 finally 里
 * `deleteLoginableUser(user)`（设备由 `tests/fixtures.ts` 的 auto fixture 收）。
 */
export async function createLoginableUser(
  root: WalnutProtocolClient,
  options: { userNamePrefix: string, roleId: string },
): Promise<LoginableUser> {
  const userName = uniqueUserName(options.userNamePrefix)
  const password = `E2e-${randomBytes(12).toString('hex')}`

  const created = await root.root<SystemUser>('POST', SystemRoutes.USER, {
    userName,
    status: true,
    roles: [options.roleId],
  })

  await installPasswordIdentity(created.id, userName, password)

  return { userName, password, userId: created.id }
}

/** 新设备 + 真实 OPAQUE 登录（设备登记给清理 fixture；不要求 MFA 已绑定） */
export async function loginAs(user: Pick<LoginableUser, 'userName' | 'password'>): Promise<WalnutProtocolClient> {
  const client = new WalnutProtocolClient({ realIp: uniqueLocalIp() })
  await client.bootstrap()
  trackDevice(client.deviceId)
  await client.login(user.userName, user.password)
  return client
}

/** 清理可登录用户（硬删；user_role / identity / user_device / RT 全部 CASCADE） */
export async function deleteLoginableUser(user: Pick<LoginableUser, 'userName'>): Promise<void> {
  await withPg(async (pg) => {
    await deleteUserByUserName(pg, user.userName)
  })
}

/**
 * 把 OPAQUE registrationRecord 作为 password identity 落库。
 *
 * 只在 fixture 层使用：注册链必须与服务端逐字节一致，否则登录会在 `server.startLogin`
 * 的 OPRF 处失败（症状是 40103，而不是「账号没有口令」）。
 *
 * **明文落 value**：服务端 `AuthOpaqueCoreService.finishRegister` 对 password identity 是
 * 直接 `upsert(value = registrationRecord, valueHash = registrationRecord)`，没有走
 * `SysUserIdentitySharedService.createIdentity` 的 AES 加密（email/phone 那几条才加密）。
 * `startLogin` 把该列的原文直接交给 `opaque.server.startLogin` —— 这里必须按同一口径写，
 * 加密后写会让 OPAQUE 拿到密文、恒 40103（R4 实施时实测踩到，记录在报告）。
 */
async function installPasswordIdentity(userId: string, userName: string, password: string): Promise<void> {
  const env = readServerStageEnv()
  const serverSetup = env.AUTH_OPAQUE_SECRET
  const appName = env.APP_NAME

  if (serverSetup === undefined || appName === undefined) {
    throw new E2ePreconditionError(
      '[e2e/account] .env.stage 缺 AUTH_OPAQUE_SECRET / APP_NAME ——'
      + ' 可登录账号 fixture 依赖与服务端同源的 OPAQUE 配置（先跑 `pnpm setup-env`）',
    )
  }

  await opaque.ready

  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password })
  const { registrationResponse } = opaque.server.createRegistrationResponse({
    serverSetup,
    // 服务端 startLogin 用的就是 userName —— 两边必须逐字一致
    userIdentifier: userName,
    registrationRequest,
  })
  const { registrationRecord } = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
    identifiers: { client: userName, server: appName },
  })

  await withPg(async (pg) => {
    await pg.query(
      `INSERT INTO sys_user_identity
         (user_id, type, purpose, value, value_hash, masked_value, verified, is_primary, status)
       VALUES ($1, 'password', 'login', $2, $2, '********', true, true, true)`,
      [userId, registrationRecord],
    )
  })
}

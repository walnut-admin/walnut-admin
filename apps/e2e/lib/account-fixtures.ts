/**
 * 可登录的**非 root** 账号 fixture（Phase 3 模块 spec / auth 矩阵共用）。
 *
 * 为什么需要它：`POST /system/user` 只建账号与角色绑定，**不带口令**；而
 * `/auth/opaque/user/register/*` 的语义是「已登录用户补挂口令」（handler 读 `req.user`）——
 * 新账号在拿到口令前无法登录，是个鸡生蛋。解法不是绕过管理端，而是用**管理员的
 * 「设置初始口令」通道**：`POST /auth/opaque/admin/password/update/{start,finish}`
 * （root 调用，按 userId 定位）—— 服务端 `finishChangePassword` 对无口令用户
 * **upsert 建 password identity**（2026-11-26 修复：此前 update 未命中静默 no-op，
 * 本 fixture 只能自己按 `finishRegister` 的口径加密后直写库）。
 *
 * 因此这里只做 OPAQUE **客户端**的两步，服务端那半（registrationResponse / 落库加密）
 * 全部走真实端点 —— fixture 不再复刻 AES-GCM/HMAC 口径，也不再需要建号时直连 PG 写
 * identity。之后所有用例都走**真实协议登录**（设备登记 → CAP → 签名握手 → OPAQUE），
 * 不伪造 AT / 会话。这与 prepare-db 的 `--admin --password` 是同一类 fixture：只补
 * 「管理端没有一次建号带口令的单端点」的缺口，不改变被测行为。
 */
import type { SystemUser } from '@walnut/api-types'
import { randomBytes } from 'node:crypto'
import * as opaque from '@serenity-kit/opaque'
import { readServerStageEnv } from '../scripts/env.ts'
import { E2ePreconditionError } from '../scripts/failure.ts'
import { trackDevice, uniqueLocalIp } from './device-fixtures.ts'
import { deleteUserByUserName, withPg } from './pg.ts'
import { WalnutProtocolClient } from './protocol/client.ts'
import { AuthRoutes, SystemRoutes } from './protocol/contract.ts'

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

  await installInitialPassword(root, created.id, userName, password)

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
 * 给无口令用户设初始口令：**真实调用**管理端 OPAQUE 改密端点。
 *
 * 客户端只跑 OPAQUE 那半（startRegistration / finishRegistration）；服务端半
 * （createRegistrationResponse、AES-GCM + 盐化 HMAC 落库）全在进程内发生 ——
 * 这条通道同时就是「无口令用户设初始密码」的用例（`finishChangePassword` 的
 * upsert 语义），fixture 不再需要从 `.env.stage` 取加密密钥/盐，也不直连 PG。
 *
 * identifiers 必须与服务端 `app.name` 一致（`client: userName` 是 OPAQUE
 * userIdentifier）；漂移的症状是登录 `startLogin` 40103。
 */
async function installInitialPassword(
  root: WalnutProtocolClient,
  userId: string,
  userName: string,
  password: string,
): Promise<void> {
  const appName = readServerStageEnv().APP_NAME

  if (appName === undefined) {
    throw new E2ePreconditionError(
      '[e2e/account] .env.stage 缺 APP_NAME —— 可登录账号 fixture 的 OPAQUE identifiers'
      + ' 依赖与服务端同源的 app.name（先跑 `pnpm setup-env`）',
    )
  }

  await opaque.ready

  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password })
  const registrationResponse = await root.root<string>(
    'POST',
    AuthRoutes.OPAQUE_ADMIN_PASSWORD_UPDATE_START,
    { id: userId, start: registrationRequest },
  )
  const { registrationRecord } = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
    identifiers: { client: userName, server: appName },
  })
  const done = await root.root<boolean>(
    'POST',
    AuthRoutes.OPAQUE_ADMIN_PASSWORD_UPDATE_FINISH,
    { id: userId, finish: registrationRecord },
  )

  if (done !== true) {
    throw new Error(`[e2e/account] admin password/update/finish 未返回 true（userId=${userId}）`)
  }
}

/**
 * 锁屏闭环 journey 的共享 fixture（J1–J4）。
 *
 * 为什么不复用 admin 账号：锁屏用例会改 `lockMode` / 设密码 / 连续失败进 30s 退避，
 * 这些状态会污染同一轮后续用例。这里为每条用例建一个**一次性账号**（admin 角色，
 * 有 `/me` 与用户管理面的权限），并真实绑定 TOTP（之后 UI / 协议登录都要过 MFA）。
 *
 * 每台设备都走真实登记（`openDevice` / `loginAs`）并交给清理 fixture；用户行由用例
 * 的 finally 硬删（`sys_user_lock` / `user_device` / identity 全 CASCADE）。
 */
import type { Browser } from '@playwright/test'
import type { LoginableUser } from '../../lib/account-fixtures.ts'
import type { DeviceSession } from '../../lib/device-fixtures.ts'
import type { WalnutProtocolClient } from '../../lib/protocol/client.ts'
import { createLoginableUser, loginAs } from '../../lib/account-fixtures.ts'
import { openDevice, resolveDeviceId, trackDevice } from '../../lib/device-fixtures.ts'
import { findRoleIdByName, withPg } from '../../lib/pg.ts'
import { SystemEndpointRoutes } from '../../lib/protocol/contract.ts'
import { loginViaUI } from '../../lib/ui.ts'

/** seed 里的非 root 管理角色：有 `/me` 与用户管理权限，MFA guard 走正常路径 */
const LOCK_TEST_ROLE = 'admin'

export interface LockTestUser {
  user: LoginableUser
  totpSecret: string
  /** 建号时用于绑 TOTP 的协议设备（已登录；也作为 J4 的「设备 A」） */
  client: WalnutProtocolClient
}

/** root 建号 → 真实 OPAQUE 登录 → 绑 TOTP（绑完 mfa_setup=true，设备级已验证） */
export async function createLockTestUser(root: WalnutProtocolClient, prefix: string): Promise<LockTestUser> {
  const roleId = await withPg(pg => findRoleIdByName(pg, LOCK_TEST_ROLE))
  const user = await createLoginableUser(root, { userNamePrefix: prefix, roleId })
  const client = await loginAs(user)
  const totpSecret = await client.bindTotp()

  return { user, totpSecret, client }
}

/** 打开一台全新设备并完成 UI 登录（CAP + MFA），返回已登录会话 */
export async function openLoggedInDevice(browser: Browser, user: LoginableUser, totpSecret: string): Promise<DeviceSession> {
  const session = await openDevice(browser, '/auth')
  await loginViaUI(session.page, {
    userName: user.userName,
    password: user.password,
    totpSecret,
  })
  session.deviceId = await resolveDeviceId(session.page)
  trackDevice(session.deviceId)
  return session
}

/** 写锁屏偏好（协议侧；`lockPwdHash` 明文由服务端 bcrypt） */
export async function setLockPreference(client: WalnutProtocolClient, payload: Record<string, unknown>): Promise<void> {
  await client.root('PATCH', SystemEndpointRoutes.USER_LOCK_PREFERENCE, payload)
}

/** security 模式的最小偏好 payload（跨设备开关由调用方覆盖） */
export function securityLockPreference(lockPwdHash: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lockMode: 'security',
    lockIdleSec: 300,
    lockSecuritySec: 60,
    lockCrossDevice: false,
    lockPwdHash,
    ...overrides,
  }
}

/** 触发当前协议设备的锁屏（`PATCH /system/user/lock`） */
export async function lockDevice(client: WalnutProtocolClient, routeName = 'Me'): Promise<void> {
  await client.root('PATCH', SystemEndpointRoutes.USER_LOCK, {
    lockRoute: {
      name: routeName,
      query: {},
      params: {},
    },
  })
}

/** 用锁屏密码解除当前协议设备的锁 */
export async function unlockDevice(client: WalnutProtocolClient, lockPwdHash: string): Promise<void> {
  await client.root('PATCH', SystemEndpointRoutes.USER_LOCK_UNLOCK, { lockPwdHash })
}

/** 新设备 + 真实登录 + 设备级 TOTP 验证（J4 的第二台 / 第三台设备） */
export async function loginVerifiedDevice(user: LoginableUser, totpSecret: string): Promise<WalnutProtocolClient> {
  const client = await loginAs(user)
  await client.verifyTotpForDevice(totpSecret)
  return client
}

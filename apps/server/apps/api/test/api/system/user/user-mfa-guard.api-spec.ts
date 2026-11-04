import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutAuthTokens } from '../../helpers/api-client'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { AppTechCacheMfaService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { Role } from '@walnut/contract'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'

/**
 * MFA guard 在 HTTP 全链上的三条信任边界（与 `libs/guards/.../mfa.guard.spec.ts` 的
 * 分支一一对照，但这里是真实缓存 / 真实 JWT payload / 真实 Redis 键）：
 *
 * | 场景 | 期望 | 观测点 |
 * |------|------|--------|
 * | 本设备 verified 缓存命中 | 20000 | `AUTH:MFA:VERIFIED:<user>:<device>` 键存在 |
 * | 本设备 verified 缓存被删 | **40115** | 键消失 + body.code |
 * | **A 设备的 verified 不覆盖 B 设备** | B=**40115** 且 A 同时 20000 | 两个 deviceId 的键各自独立 |
 * | **visitor 角色跳过**（P4） | 20000 | 缓存键**始终不存在**（不是缓存命中的侥幸） |
 * | 对照：同用户 switchable+root、mfa_setup=false | **40114** | 同一设备、同一端点，只换当前角色 |
 *
 * 用例顺序有依赖（vitest 按声明序执行）：1–3 在设备 A 上跑 root 用户；4–5 在设备 B 上
 * 依次登录 visitor / 切回 root 的同一用户 —— 后者只改 `current_role_id`，把「visitor 是
 * 一个角色特例，不是用户/设备特例」钉住。
 */

describe('MFA guard：设备级 verified 缓存 + visitor 跳过（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  /** 设备 A（root 用户主设备） */
  let apiA: WalnutApiClient
  /** 设备 B（同用户第二设备 / visitor 登录复用） */
  let apiB: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  /** MFA guard 在设备 A 上的基准用户（mfa_setup=true，COMBINE + root） */
  let rootFixture: WalnutRootUserFixture | null = null
  /** visitor 用例的同一用户（先 visitor，再切回 root 做对照） */
  let switchFixture: WalnutRootUserFixture | null = null
  let tokensA: WalnutAuthTokens | null = null
  let tokensB: WalnutAuthTokens | null = null

  let visitorRoleId = ''
  let createdVisitorRoleId: string | null = null

  /** 非 MFAFree 的全链端点（无 permission 元数据 ⇒ visitor 也能走到处理器） */
  const PROBE_PATH = '/system/user/me/profile'

  function mfaCacheKey(userId: string, deviceId: string): string {
    return `${WalnutAdminConstAppCacheKeys.AUTH_MFA_VERIFIED}:${userId}:${deviceId}`
  }

  function cacheMfa(): AppTechCacheMfaService {
    return app.get(AppTechCacheMfaService)
  }

  async function probe(client: WalnutApiClient): Promise<number> {
    const res = await client.root('GET', client.apiPath(PROBE_PATH))
    return bodyOf(res).code
  }

  /**
   * 登录 / 重新登录。
   *
   * 两个必须先做的动作：
   * 1. 已经带着登录态时先走**真实 signout** —— login/finish 的 duplicate 判据是
   *    「(userId, deviceId) 存在未撤销 RT 行」（refresh.shared.service generateRefreshToken），
   *    同设备同用户重登否则是 40109 DuplicateSignIn（permission-chain 同款手法）；
   * 2. 清 auth 再用 anon 单因子签名 —— 登录链是 JwtFree，带登录态会按双因子签名算，服务端
   *    按单因子校验 ⇒ 40112。
   */
  async function loginOn(client: WalnutApiClient, fixture: WalnutRootUserFixture): Promise<WalnutAuthTokens> {
    if (client.getAuth() !== null) {
      const signoutRes = await client.anon('POST', client.apiPath('/auth/signout'))
      expectOk(signoutRes, 'signout before re-login')
    }

    client.setAuth(null)
    const tokens = await performHttpOpaqueLogin(client, app, fixture)
    client.setAuth(tokens)
    return tokens
  }

  /** role_name 全局唯一：已有 visitor 行就复用，没有才现建（afterAll 只删本 spec 建的那行） */
  async function ensureVisitorRoleId(): Promise<string> {
    const existing: Array<{ id: string }> = await apiA.pgDataSource.query(
      'SELECT id FROM sys_role WHERE role_name = $1',
      [Role.VISITOR],
    )
    if (existing.length > 0) {
      return existing[0].id
    }

    const inserted: Array<{ id: string }> = await apiA.pgDataSource.query(
      'INSERT INTO sys_role (role_name) VALUES ($1) ON CONFLICT (role_name) DO NOTHING RETURNING id',
      [Role.VISITOR],
    )
    if (inserted.length > 0) {
      createdVisitorRoleId = inserted[0].id
      return createdVisitorRoleId
    }

    const fallback: Array<{ id: string }> = await apiA.pgDataSource.query(
      'SELECT id FROM sys_role WHERE role_name = $1',
      [Role.VISITOR],
    )
    return fallback[0].id
  }

  /**
   * 把用户切成「switchable + currentRole」，junction 只留这一个角色。
   * AT payload 的 roleMode/currentRoleName 在登录时固化 ⇒ 调用后必须重新登录。
   */
  async function switchUserRole(fixture: WalnutRootUserFixture, roleId: string, mfaSetup: boolean): Promise<void> {
    const pg = apiA.pgDataSource
    await pg.query('DELETE FROM sys_user_role WHERE user_id = $1', [fixture.userId])
    await pg.query(
      'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [fixture.userId, roleId],
    )
    await pg.query(
      'UPDATE sys_user SET role_mode = $2, current_role_id = $3, mfa_setup = $4 WHERE id = $1',
      [fixture.userId, WalnutAdminConstRoleMode.SWITCH, roleId, mfaSetup],
    )
  }

  beforeAll(async () => {
    app = await createApiApp()
    apiA = await WalnutApiClient.create(app)
    apiB = await WalnutApiClient.create(app)

    rootFixture = await registerRootUserFixture(app, apiA.pgDataSource, `mfa-guard-a-${seed8}`)
    switchFixture = await registerRootUserFixture(app, apiA.pgDataSource, `mfa-guard-v-${seed8}`)
    visitorRoleId = await ensureVisitorRoleId()

    tokensA = await loginOn(apiA, rootFixture)
    await apiA.seedMfaVerifiedCache(rootFixture.userId)
  })

  afterAll(async () => {
    if (apiA !== undefined && rootFixture !== null) {
      const pg = apiA.pgDataSource
      for (const fixture of [rootFixture, switchFixture]) {
        if (fixture === null) {
          continue
        }
        await pg.query('DELETE FROM sys_user_lock WHERE user_id = $1', [fixture.userId])
        await pg.query('UPDATE sys_user_device SET locked = false WHERE user_id = $1', [fixture.userId])
        await pg.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
        await pg.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      }
      for (const deviceId of [apiA.deviceId, apiB.deviceId]) {
        await pg.query('DELETE FROM sys_device WHERE device_id = $1', [deviceId])
      }
      if (createdVisitorRoleId !== null) {
        await pg.query('DELETE FROM sys_role WHERE id = $1', [createdVisitorRoleId])
      }
      await apiA.cleanupWalnutCacheKeys(
        seed8,
        apiA.deviceId,
        apiB.deviceId,
        rootFixture.userId,
        switchFixture?.userId ?? '',
      )
    }
    await app.close()
  })

  it('设备 A：verified 缓存命中 ⇒ 20000（缓存键在 Redis 里真实存在）', async () => {
    expect(apiA.deviceId).not.toBe('')

    // 登录时固化的 payload：mfa_setup=true（P5 放行）、mfaVerified=false（走 P7 缓存腿）
    const payload = JSON.parse(
      Buffer.from(tokensA!.accessToken.split('.')[1], 'base64url').toString('utf8'),
    ) as { mfaSetup: boolean, mfaVerified: boolean }
    expect(payload.mfaSetup).toBe(true)
    expect(payload.mfaVerified).toBe(false)

    expect(await apiA.hasWalnutCacheKey(mfaCacheKey(rootFixture!.userId, apiA.deviceId))).toBe(true)

    expect(await probe(apiA)).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
  })

  it('设备 A：verified 缓存被删 ⇒ 40115 MfaVerifyFailed；种回 ⇒ 恢复 20000', async () => {
    const key = mfaCacheKey(rootFixture!.userId, apiA.deviceId)

    await cacheMfa().delVerifiedCache(rootFixture!.userId, apiA.deviceId)
    expect(await cacheMfa().getVerifiedCache(rootFixture!.userId, apiA.deviceId)).toBeNull()
    expect(await apiA.hasWalnutCacheKey(key)).toBe(false)

    expect(await probe(apiA)).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED)

    await apiA.seedMfaVerifiedCache(rootFixture!.userId)
    expect(await apiA.hasWalnutCacheKey(key)).toBe(true)
    expect(await probe(apiA)).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
  })

  it('跨设备信任边界：A 的 verified 不覆盖 B ⇒ B=40115，同期 A 仍 20000', async () => {
    expect(apiB.deviceId).not.toBe(apiA.deviceId)

    tokensB = await loginOn(apiB, rootFixture!)
    // B 从没种过 verified 缓存（登录不写这条键）
    expect(await cacheMfa().getVerifiedCache(rootFixture!.userId, apiB.deviceId)).toBeNull()
    expect(await apiB.hasWalnutCacheKey(mfaCacheKey(rootFixture!.userId, apiB.deviceId))).toBe(false)

    // A 的缓存不受 B 登录影响，也不被 B 借用
    expect(await apiA.hasWalnutCacheKey(mfaCacheKey(rootFixture!.userId, apiA.deviceId))).toBe(true)

    expect(await probe(apiB)).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED)
    expect(await probe(apiA)).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
  })

  it('visitor 角色跳过 MFA：无 verified 缓存（且 mfa_setup=false）仍 20000', async () => {
    await switchUserRole(switchFixture!, visitorRoleId, false)
    tokensB = await loginOn(apiB, switchFixture!)

    // AT payload 自洽：switchable + currentRoleName=visitor + mfaSetup=false
    const payload = JSON.parse(
      Buffer.from(tokensB.accessToken.split('.')[1], 'base64url').toString('utf8'),
    ) as { roleMode: string, currentRoleName: string, mfaSetup: boolean, mfaVerified: boolean }
    expect(payload.roleMode).toBe(WalnutAdminConstRoleMode.SWITCH)
    expect(payload.currentRoleName).toBe(Role.VISITOR)
    expect(payload.mfaSetup).toBe(false)
    expect(payload.mfaVerified).toBe(false)

    expect(await apiB.hasWalnutCacheKey(mfaCacheKey(switchFixture!.userId, apiB.deviceId))).toBe(false)

    expect(await probe(apiB)).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

    // 跳过是 P4 短路 —— 请求过程不会顺手写 verified 缓存
    expect(await cacheMfa().getVerifiedCache(switchFixture!.userId, apiB.deviceId)).toBeNull()
    expect(await apiB.hasWalnutCacheKey(mfaCacheKey(switchFixture!.userId, apiB.deviceId))).toBe(false)
  })

  it('对照：同一用户切回 switchable+root（mfa_setup 仍 false）⇒ 40114 MfaRequired', async () => {
    await switchUserRole(switchFixture!, switchFixture!.roleId, false)
    tokensB = await loginOn(apiB, switchFixture!)

    const payload = JSON.parse(
      Buffer.from(tokensB.accessToken.split('.')[1], 'base64url').toString('utf8'),
    ) as { roleMode: string, currentRoleName: string, mfaSetup: boolean }
    expect(payload.roleMode).toBe(WalnutAdminConstRoleMode.SWITCH)
    expect(payload.currentRoleName).toBe(Role.ROOT)
    expect(payload.mfaSetup).toBe(false)

    // 同一设备、同一端点：唯一变化是当前角色 ⇒ 出口从 20000 变 40114
    expect(await probe(apiB)).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_REQUIRED)
    expect(await cacheMfa().getVerifiedCache(switchFixture!.userId, apiB.deviceId)).toBeNull()
  })

  it('边界：设备 A 的 visitor 跳过不影响 A 上 root 用户的 40115 判定（按用户+设备分键）', async () => {
    // 造一个「A 设备上没有 verified 缓存的 root 用户」的最快方式是删掉 A 的键
    await cacheMfa().delVerifiedCache(rootFixture!.userId, apiA.deviceId)
    expect(await probe(apiA)).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED)

    // 还原：后续（若有）用例与 afterAll 的清洁度
    await apiA.seedMfaVerifiedCache(rootFixture!.userId)
    expect(await probe(apiA)).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
  })
})

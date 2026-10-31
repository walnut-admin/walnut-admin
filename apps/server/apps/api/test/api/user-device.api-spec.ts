import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * C 段：`system/user/device` —— list / update-name / lock / unlock / force-quit。
 *
 * 数据前置：登录链路本身已绑 sys_user_device（bindDeviceForUser，登录事务内）并落了
 * RT 行；lock/unlock/force-quit 都要先有 app_monitor_user 行（findByUserIdAndDeviceId
 * 查无即 40401）—— 用例自插自清。
 *
 * 关键现状：
 * - update-name 命中即改（未命中返回 null 不抛，controller 恒 true）；
 * - lock 落 sys_user_device.locked + 建 sys_user_lock 偏好行（空 lockRoute jsonb 默认）；
 *   unlock 无偏好行 → 40401；unlock 不带 lockPwdHash 时跳过密码比对；
 * - force-quit（user-kick-other 语义）撤 RT：revoke 落 revoked + revoke_reason
 *   （WalnutAdminConstRevokeRTType.userKickOther）；updateRevokedAndReason 全量撤销
 *   （P1-9 已修：update ... where userId+deviceId，同维度多行 RT 撤干净）。
 * - P2-12（2026-10-28）：踢人不再只撤 RT —— 事务提交后按设备清 `AUTH:SESSIONS` /
 *   `AUTH:PERMISSIONS` / `AUTH:MFA:VERIFIED`（P0-4 的 JWT 会话校验让被踢设备的 AT
 *   立即 40101，而不只是 RT 不可换发）。
 */

interface UserDeviceListItem {
  deviceId: string
  deviceName: string | null
  locked: boolean
  lastActiveAt: string | null
  deviceType?: string
  current: boolean
  auth?: boolean
  location?: string
}

describe('C 段：system/user/device list/update-name/lock/force-quit（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  const visitorId = `ud-spec-vis-${seed8}`
  let fixture: WalnutRootUserFixture | null = null
  /** force-quit 用例的“第二设备”（同用户）—— 踢它不影响本文件的 api 客户端 */
  let victim: WalnutApiClient | null = null

  async function insertMonitorRow(deviceId: string = api.deviceId) {
    await api.pgDataSource.query(
      `INSERT INTO app_monitor_user (visitor_id, user_id, device_id, auth, focus, is_left)
       VALUES ($1, $2, $3, true, true, false)`,
      [visitorId, fixture!.userId, deviceId],
    )
  }

  async function cleanSideRows() {
    await api.pgDataSource.query('DELETE FROM app_monitor_user WHERE visitor_id = $1', [visitorId])
    await api.pgDataSource.query('DELETE FROM auth_refresh_token WHERE user_id = $1', [fixture?.userId])
    await api.pgDataSource.query('DELETE FROM sys_user_lock WHERE user_id = $1', [fixture?.userId])
    if (fixture !== null) {
      await api.pgDataSource.query('UPDATE sys_user_device SET locked = false WHERE user_id = $1', [fixture.userId])
      // SECURITY_LOCK 缓存（lock 默认 cross-device → 全局键）不随库清，显式清防 40118 残留
      // （P1-2 已修 delByPattern；这里按已知键逐个删仍是更直接的清场方式）
      const cacheService = app.get(AppTechCacheService)
      const lockKeys = WalnutAdminConstAppCacheKeys.SECURITY_LOCK
      await cacheService.del(`${lockKeys}:${fixture.userId}:global`)
      await cacheService.del(`${lockKeys}:${fixture.userId}:${api.deviceId}`)

      if (victim !== null) {
        await api.pgDataSource.query('DELETE FROM sys_user_device WHERE user_id = $1 AND device_id = $2', [fixture.userId, victim.deviceId])
        await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [victim.deviceId])
        await cacheService.del(`${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:${fixture.userId}:${victim.deviceId}`)
        await cacheService.del(`${WalnutAdminConstAppCacheKeys.AUTH_MFA_VERIFIED}:${fixture.userId}:${victim.deviceId}`)
        victim = null
      }
    }
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `ud-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterEach(async () => {
    await cleanSideRows()
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await cleanSideRows()
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('list → 登录绑定的设备在场：current=true、deviceType/location 装回', async () => {
    const res = await api.root('GET', api.apiPath('/system/user/device/list'))
    expectOk(res, 'user device list')

    const list = bodyOf<{ data: UserDeviceListItem[], total: number }>(res).data
    expect(list.total).toBe(1)
    const item = list.data[0]
    expect(item.deviceId).toBe(api.deviceId)
    expect(item.current).toBe(true)
    expect(item.locked).toBe(false)
    // bootstrap initial 的 deviceName 是 `api-spec-xxxxxxxx`
    expect(item.deviceName).toContain('api-spec-')
    // Windows Chrome UA → DESKTOP
    expect(item.deviceType?.toUpperCase()).toBe('DESKTOP')
  })

  it('update-name → true 且持久化；list 回新名', async () => {
    const newName = `renamed-${seed8}`
    const res = await api.root('PUT', api.apiPath(`/system/user/device/update-name/${api.deviceId}`), {
      deviceName: newName,
    })
    expectOk(res, 'user device update-name')
    expect(bodyOf<boolean>(res).data).toBe(true)
    const rows: Array<{ device_name: string | null }> = await api.pgDataSource.query(
      'SELECT device_name FROM sys_user_device WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, api.deviceId],
    )
    expect(rows[0].device_name).toBe(newName)

    const listRes = await api.root('GET', api.apiPath('/system/user/device/list'))
    expect(bodyOf<{ data: UserDeviceListItem[] }>(listRes).data.data[0].deviceName).toBe(newName)
  })

  it('update-name 非法 deviceId → 40099（device_id 形态管道：HMAC-SHA256 hex 64 位；四个 :deviceId 端点同管道，代表性钉一处）', async () => {
    const res = await api.root('PUT', api.apiPath('/system/user/device/update-name/not-a-device-id'), {
      deviceName: 'x',
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('lock/unlock → 落 sys_user_device.locked + 建 sys_user_lock 偏好行；锁定期间 Lock guard 40118', async () => {
    // 无 monitor 行：lock 40401（前置查 app_monitor_user）
    const noMonitor = await api.root('PUT', api.apiPath(`/system/user/device/lock/${api.deviceId}`))
    expect(bodyOf(noMonitor).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    await insertMonitorRow()

    // 无 lock 偏好行：unlock 40401
    const unlockNoPref = await api.root('PUT', api.apiPath(`/system/user/device/unlock/${api.deviceId}`), {})
    expect(bodyOf(unlockNoPref).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const lockRes = await api.root('PUT', api.apiPath(`/system/user/device/lock/${api.deviceId}`))
    expectOk(lockRes, 'user device lock')
    expect(bodyOf<boolean>(lockRes).data).toBe(true)

    let rows: Array<{ locked: boolean }> = await api.pgDataSource.query(
      'SELECT locked FROM sys_user_device WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, api.deviceId],
    )
    expect(rows[0].locked).toBe(true)

    const prefRows: Array<{ lock_mode: string, lock_route: unknown, lock_cross_device: boolean }> = await api.pgDataSource.query(
      'SELECT lock_mode, lock_route, lock_cross_device FROM sys_user_lock WHERE user_id = $1',
      [fixture!.userId],
    )
    expect(prefRows).toHaveLength(1)
    expect(prefRows[0].lock_mode).toBe('default')
    // 未带 lockRoute 落 DB 默认空对象；cross_device 走 DB 默认 true
    expect(prefRows[0].lock_route).toEqual({})
    expect(prefRows[0].lock_cross_device).toBe(true)

    // 锁定状态已进 SECURITY_LOCK 缓存（cross-device → 全局键）→ 非 LockFree 端点 40118
    const blockedRes = await api.root('GET', api.apiPath('/system/user/device/list'))
    expect(bodyOf(blockedRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)

    // 复位锁定现场（等价「另一通道」已把 DB 与缓存都解锁）：P1-20 修复后删缓存不再
    // 等于解锁 —— 锁守卫 miss 会回源 sys_user_device.locked，仍 40118。因此这里同时把
    // DB 行置回未锁，再走真实 HTTP unlock 端点（端点对未锁状态幂等）。
    await api.pgDataSource.query(
      'UPDATE sys_user_device SET locked = false WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, api.deviceId],
    )
    const lockKeys = WalnutAdminConstAppCacheKeys.SECURITY_LOCK
    const cacheService = app.get(AppTechCacheService)
    await cacheService.del(`${lockKeys}:${fixture!.userId}:global`)
    await cacheService.del(`${lockKeys}:${fixture!.userId}:${api.deviceId}`)

    const unlockRes = await api.root('PUT', api.apiPath(`/system/user/device/unlock/${api.deviceId}`), {})
    expectOk(unlockRes, 'user device unlock')

    rows = await api.pgDataSource.query(
      'SELECT locked FROM sys_user_device WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, api.deviceId],
    )
    expect(rows[0].locked).toBe(false)

    // list 回 locked=false
    const listRes = await api.root('GET', api.apiPath('/system/user/device/list'))
    expect(bodyOf<{ data: UserDeviceListItem[] }>(listRes).data.data[0].locked).toBe(false)
  })

  it('force-quit → 撤该用户该设备全部 RT；P2-12：旧 AT 立即 40101 + 会话/权限/MFA 缓存全清', async () => {
    // 第二设备真实登录（同一 fixture 用户）—— 踢它，api 客户端不受影响
    victim = await WalnutApiClient.create(app)
    const victimTokens = await performHttpOpaqueLogin(victim, app, fixture!)
    victim.setAuth(victimTokens)

    await insertMonitorRow(victim.deviceId)

    // 登录期 RT 行先清掉，只留本用例自插的两行（踢完必须全部 revoked）
    await api.pgDataSource.query(
      'DELETE FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, victim.deviceId],
    )
    for (let i = 0; i < 2; i++) {
      await api.pgDataSource.query(
        `INSERT INTO auth_refresh_token (jti, user_id, device_id, encrypted_token, expired_at)
         VALUES ($1, $2, $3, 'ud-spec-rt', NOW() + INTERVAL '1 day')`,
        [randomUUID(), fixture!.userId, victim.deviceId],
      )
    }

    // 预置被踢设备的权限 / MFA 缓存（清扫前必须存在，否则断言是空转）
    const cacheService = app.get(AppTechCacheService)
    const permissionKey = `${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:${fixture!.userId}:${victim.deviceId}`
    const mfaKey = `${WalnutAdminConstAppCacheKeys.AUTH_MFA_VERIFIED}:${fixture!.userId}:${victim.deviceId}`
    await cacheService.set(permissionKey, ['system:user:device:list'], { t: WalnutAdminConstAppCacheType.AUTH, ttl: 600 })
    await victim.seedMfaVerifiedCache(fixture!.userId)
    expect(await api.hasWalnutCacheKey(permissionKey)).toBe(true)
    expect(await api.hasWalnutCacheKey(mfaKey)).toBe(true)

    const res = await api.root('DELETE', api.apiPath(`/system/user/device/force-quit/${victim.deviceId}`))
    expectOk(res, 'user device force-quit')
    expect(bodyOf<boolean>(res).data).toBe(true)

    const rtRows: Array<{ revoked: boolean, revoke_reason: string | null }> = await api.pgDataSource.query(
      'SELECT revoked, revoke_reason FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, victim.deviceId],
    )
    expect(rtRows.length).toBe(2)
    // P1-9 已修（revoke-and-insert 配套，2026-10-27）：updateRevokedAndReason 改
    // update ... where userId+deviceId 全量撤销 —— 同维度多行 RT 踢完必须全部 revoked
    // （旧钉现状：findOne 只撤「查到的第一行」，其余行仍可换发）
    const revokedRows = rtRows.filter(r => r.revoked)
    expect(revokedRows).toHaveLength(2)
    // WalnutAdminConstRevokeRTType.userKickOther
    expect(revokedRows.every(r => r.revoke_reason === 'userKickOther')).toBe(true)

    // P2-12 翻转：此前只断言 RT revoked —— 会话键仍在，AT 到期前继续可用。
    // 现在 JWT validate（P0-4）查会话键，被踢设备的旧 AT 必须立即 40101。
    const victimAfterKick = await victim.root('GET', victim.apiPath('/system/user/device/list'))
    expect(bodyOf(victimAfterKick).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)

    // 权限 / MFA verified 缓存同事务后清扫
    expect(await api.hasWalnutCacheKey(permissionKey)).toBe(false)
    expect(await api.hasWalnutCacheKey(mfaKey)).toBe(false)
  })

  it('边界：force-quit 无 monitor 行 → 40401', async () => {
    const res = await api.root('DELETE', api.apiPath(`/system/user/device/force-quit/${api.deviceId}`))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  })

  it('边界：匿名 list → 40101', async () => {
    const res = await api.anon('GET', api.apiPath('/system/user/device/list'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })
})

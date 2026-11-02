import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * C 段：`system/user/lock` —— GET read + PATCH lock/unlock me（LockFree 端点组）。
 *
 * 两套「默认值」的对拍（钉现状）：无偏好行时 service 兜底（lockIdleSec=300、
 * lockCrossDevice=false）；首次 lock 落 sys_user_lock 行后，DB 默认值接管
 * （lockIdleSec=600、lockCrossDevice=true → read 走跨设备判定腿）。
 * lock/unlock 的落点是 sys_user_device.locked（单设备）或全部设备（跨设备），
 * sys_user_lock 只存偏好与锁屏路由。
 */

interface LockStatus {
  locked: boolean
  lockRoute: { name?: string } | null
  lockCrossDevice: boolean
  lockMode: string
  lockIdleSec: number
  lockSecuritySec: number
}

describe('C 段：system/user/lock read + lock/unlock me（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null

  async function cleanLockRows() {
    if (fixture === null) {
      return
    }
    await api.pgDataSource.query('DELETE FROM sys_user_lock WHERE user_id = $1', [fixture.userId])
    await api.pgDataSource.query('UPDATE sys_user_device SET locked = false WHERE user_id = $1', [fixture.userId])
    // SECURITY_LOCK 缓存（lock 默认 cross-device → 全局键）不随库清，显式清防残留
    // （delByPattern 走 node-redis v5 的 del rest-args 语义会炸 —— 按已知键逐个删）
    const cacheService = app.get(AppTechCacheService)
    const lockKeys = WalnutAdminConstAppCacheKeys.SECURITY_LOCK
    await cacheService.del(`${lockKeys}:${fixture.userId}:global`)
    await cacheService.del(`${lockKeys}:${fixture.userId}:${api.deviceId}`)
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `ulk-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterEach(async () => {
    await cleanLockRows()
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await cleanLockRows()
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('read 无偏好行 → service 兜底默认（locked=false、lockIdleSec=300、crossDevice=false）', async () => {
    const res = await api.root('GET', api.apiPath('/system/user/lock/read'))
    expectOk(res, 'user lock read default')

    const data = bodyOf<LockStatus>(res).data
    expect(data).toEqual({
      locked: false,
      lockRoute: null,
      lockCrossDevice: false,
      lockMode: 'default',
      lockIdleSec: 300,
      lockSecuritySec: 60,
    })
  })

  it('PATCH lock → true；偏好行落 DB 默认；read 走跨设备腿回 locked=true + lockIdleSec=600', async () => {
    const lockRes = await api.root('PATCH', api.apiPath('/system/user/lock'), {
      lockRoute: { name: `lock-spec-${seed8}` },
    })
    expectOk(lockRes, 'user lock')
    expect(bodyOf<boolean>(lockRes).data).toBe(true)

    const prefRows: Array<{ lock_route: { name?: string }, lock_cross_device: boolean, lock_idle_sec: number }> = await api.pgDataSource.query(
      'SELECT lock_route, lock_cross_device, lock_idle_sec FROM sys_user_lock WHERE user_id = $1',
      [fixture!.userId],
    )
    expect(prefRows).toHaveLength(1)
    expect(prefRows[0].lock_route.name).toBe(`lock-spec-${seed8}`)
    expect(prefRows[0].lock_cross_device).toBe(true)
    expect(prefRows[0].lock_idle_sec).toBe(600)

    const readRes = await api.root('GET', api.apiPath('/system/user/lock/read'))
    const data = bodyOf<LockStatus>(readRes).data
    expect(data.locked).toBe(true)
    expect(data.lockCrossDevice).toBe(true)
    expect(data.lockIdleSec).toBe(600)
    expect(data.lockRoute?.name).toBe(`lock-spec-${seed8}`)

    // 跨设备腿把该用户全部设备行置锁（本 fixture 只有一台）
    const deviceRows: Array<{ locked: boolean }> = await api.pgDataSource.query(
      'SELECT locked FROM sys_user_device WHERE user_id = $1',
      [fixture!.userId],
    )
    expect(deviceRows[0].locked).toBe(true)
  })

  it('PATCH unlock → true；read 回 locked=false；DB 设备行解锁', async () => {
    await api.root('PATCH', api.apiPath('/system/user/lock'), { lockRoute: { name: 'x' } })

    const unlockRes = await api.root('PATCH', api.apiPath('/system/user/lock/unlock'), {})
    expectOk(unlockRes, 'user unlock')
    expect(bodyOf<boolean>(unlockRes).data).toBe(true)

    const readRes = await api.root('GET', api.apiPath('/system/user/lock/read'))
    expect(bodyOf<LockStatus>(readRes).data.locked).toBe(false)

    const deviceRows: Array<{ locked: boolean }> = await api.pgDataSource.query(
      'SELECT locked FROM sys_user_device WHERE user_id = $1',
      [fixture!.userId],
    )
    expect(deviceRows[0].locked).toBe(false)
  })

  it('P2-26：偏好写入通道 —— security 模式必须带密码；bcrypt 落库且 read 回 lockMode', async () => {
    // 无密码（库里也没有旧 hash）→ 40000 pwdRequired
    const noPwd = await api.root('PATCH', api.apiPath('/system/user/lock/preference'), {
      lockMode: 'security',
    })
    expect(bodyOf(noPwd).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const prefRes = await api.root('PATCH', api.apiPath('/system/user/lock/preference'), {
      lockMode: 'security',
      lockPwdHash: 'pin-123456',
      lockCrossDevice: true,
      lockIdleSec: 120,
      lockSecuritySec: 30,
    })
    expectOk(prefRes, 'lock preference update (security)')
    expect(bodyOf<boolean>(prefRes).data).toBe(true)

    const prefRows: Array<{ lock_mode: string, lock_pwd_hash: string, lock_idle_sec: number, lock_security_sec: number, lock_cross_device: boolean }> = await api.pgDataSource.query(
      'SELECT lock_mode, lock_pwd_hash, lock_idle_sec, lock_security_sec, lock_cross_device FROM sys_user_lock WHERE user_id = $1',
      [fixture!.userId],
    )
    expect(prefRows[0].lock_mode).toBe('security')
    // P1-10/P1-19 的同款 bcrypt 写入路径：入参明文，落库是 bcrypt hash
    expect(prefRows[0].lock_pwd_hash).not.toBe('pin-123456')
    expect(prefRows[0].lock_pwd_hash).toMatch(/^\$2[aby]\$/)
    expect(prefRows[0].lock_idle_sec).toBe(120)
    expect(prefRows[0].lock_security_sec).toBe(30)
    expect(prefRows[0].lock_cross_device).toBe(true)

    const readRes = await api.root('GET', api.apiPath('/system/user/lock/read'))
    expect(bodyOf<LockStatus>(readRes).data.lockMode).toBe('security')
  })

  it('P2-26：security 模式跨设备解锁必须带密码（缺省/错密 40000，对密成功）', async () => {
    // 第二设备（同 fixture 用户）真实登录：跨设备锁定会同时锁住两台设备
    const apiB = await WalnutApiClient.create(app)
    const tokensB = await performHttpOpaqueLogin(apiB, app, fixture!)
    apiB.setAuth(tokensB)
    await apiB.seedMfaVerifiedCache(fixture!.userId)

    try {
      // 偏好：security + 密码 + 跨设备
      const prefRes = await api.root('PATCH', api.apiPath('/system/user/lock/preference'), {
        lockMode: 'security',
        lockPwdHash: 'pin-abcdef',
        lockCrossDevice: true,
      })
      expectOk(prefRes, 'lock preference security cross-device')

      // 设备 A 置锁 → 跨设备腿锁住全部 user_device 行
      const lockRes = await api.root('PATCH', api.apiPath('/system/user/lock'), {
        lockRoute: { name: `lock-security-${seed8}` },
      })
      expectOk(lockRes, 'lock security mode')

      // 设备 B 解锁：缺密码 → 40000（旧实现缺省直接跳过密码比对）
      const noPwd = await apiB.root('PATCH', apiB.apiPath('/system/user/lock/unlock'), {})
      expect(bodyOf(noPwd).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

      // 错密码 → 40000；设备仍锁定
      const wrongPwd = await apiB.root('PATCH', apiB.apiPath('/system/user/lock/unlock'), {
        lockPwdHash: 'pin-wrong',
      })
      expect(bodyOf(wrongPwd).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

      const stillLocked: Array<{ locked: boolean }> = await api.pgDataSource.query(
        'SELECT locked FROM sys_user_device WHERE user_id = $1',
        [fixture!.userId],
      )
      expect(stillLocked.every(row => row.locked)).toBe(true)

      // 对密码 → 解锁成功（全部设备）
      const unlockRes = await apiB.root('PATCH', apiB.apiPath('/system/user/lock/unlock'), {
        lockPwdHash: 'pin-abcdef',
      })
      expectOk(unlockRes, 'unlock with correct password')
      expect(bodyOf<boolean>(unlockRes).data).toBe(true)

      const unlocked: Array<{ locked: boolean }> = await api.pgDataSource.query(
        'SELECT locked FROM sys_user_device WHERE user_id = $1',
        [fixture!.userId],
      )
      expect(unlocked.every(row => row.locked === false)).toBe(true)
    }
    finally {
      // 第二设备的 user_device / device 行与锁缓存清理（afterEach 只清本客户端设备键）
      await api.pgDataSource.query(
        'DELETE FROM sys_user_device WHERE user_id = $1 AND device_id = $2',
        [fixture!.userId, apiB.deviceId],
      )
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [apiB.deviceId])
      const cacheService = app.get(AppTechCacheService)
      await cacheService.del(`${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${fixture!.userId}:${apiB.deviceId}`)
      // 只按第二设备 id 清缓存键：按 fixture.userId / seed 片段清会连带删掉设备 A 的
      // AUTH:SESSIONS 键，后续用例全部 40101
      await apiB.cleanupWalnutCacheKeys(apiB.deviceId)
    }
  })

  it('边界：无偏好行时 unlock → 40401（偏好行存在性检查）', async () => {
    const res = await api.root('PATCH', api.apiPath('/system/user/lock/unlock'), {})
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  })

  it('边界：匿名 read → 40101（LockFree 只免锁守卫，JWT 仍拦）', async () => {
    const res = await api.anon('GET', api.apiPath('/system/user/lock/read'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })
})

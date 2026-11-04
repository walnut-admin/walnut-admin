import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'
/**
 * C 段：`system/user/me` —— GET profile（populated roles 读腿）、PUT profile
 * （userName/nickName 必填 + avatar/description/gender 可选）、GET security-tab2
 * （getUserMfaTotalStatus：totp/webauthn 两通道的总状态形状）。
 *
 * me 系端点用 root 自己的身份即可；security-tab2 的「有 totp 行」分支用 PG 直插
 * sys_user_mfa 行制造（getUserMfaTotalStatus 只读 sys_user_mfa，无其他前置）。
 */

interface ProfileRow {
  id: string
  userName?: string | null
  nickName?: string | null
  description?: string | null
  gender?: number
  avatar?: string | null
  roles_count?: number
  roles_list?: Array<{ id: string, roleName?: string }>
}

interface SecurityTab2 {
  totp: { status: boolean, verified: boolean }
  webauthn: { status: boolean, verified: boolean }
}

describe('C 段：system/user/me profile + security-tab2（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `me-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user_mfa WHERE user_id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('GET profile → 20000，root 身份 + roles_list（junction 读腿）', async () => {
    const res = await api.root('GET', api.apiPath('/system/user/me/profile'))
    expectOk(res, 'me profile get')

    const row = bodyOf<ProfileRow>(res).data
    expect(row.id).toBe(fixture!.userId)
    expect(row.userName).toBe(fixture!.userName)
    expect(row.roles_count).toBe(1)
    expect(row.roles_list?.[0]?.roleName).toBe('root')
  })

  it('PUT profile → 修改 nickName/description/gender 持久化；GET 回读一致', async () => {
    const updateRes = await api.root('PUT', api.apiPath('/system/user/me/profile'), {
      userName: fixture!.userName,
      nickName: `nick-${seed8}`,
      description: `me-spec desc ${seed8}`,
      gender: 1,
    })
    expectOk(updateRes, 'me profile update')
    const updated = bodyOf<ProfileRow>(updateRes).data
    expect(updated.nickName).toBe(`nick-${seed8}`)
    expect(updated.gender).toBe(1)

    const readRes = await api.root('GET', api.apiPath('/system/user/me/profile'))
    const row = bodyOf<ProfileRow>(readRes).data
    expect(row.nickName).toBe(`nick-${seed8}`)
    expect(row.description).toBe(`me-spec desc ${seed8}`)
  })

  it('PUT profile 缺必填 userName/nickName → 40099；gender 越枚举 → 40099', async () => {
    const missing = await api.root('PUT', api.apiPath('/system/user/me/profile'), {
      nickName: 'x',
    })
    expect(bodyOf(missing).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const badGender = await api.root('PUT', api.apiPath('/system/user/me/profile'), {
      userName: fixture!.userName,
      nickName: 'x',
      gender: 5,
    })
    expect(bodyOf(badGender).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('GET security-tab2 → 初始双通道全关的形状', async () => {
    const res = await api.root('GET', api.apiPath('/system/user/me/security-tab2'))
    expectOk(res, 'security tab2 get')

    const data = bodyOf<SecurityTab2>(res).data
    expect(data.totp).toEqual({ status: false, verified: false })
    expect(data.webauthn).toEqual({ status: false, verified: false })
  })

  it('GET security-tab2 → 有 totp 行后 verified=true、status 随行', async () => {
    await api.pgDataSource.query(
      `INSERT INTO sys_user_mfa (user_id, type, device_id, name, status)
       VALUES ($1, 'totp', $2, 'me-spec totp', false)`,
      [fixture!.userId, api.deviceId],
    )

    const res = await api.root('GET', api.apiPath('/system/user/me/security-tab2'))
    const data = bodyOf<SecurityTab2>(res).data
    // verified 只看「行存在」，status 透传行上的开关
    expect(data.totp).toEqual({ status: false, verified: true })
    expect(data.webauthn).toEqual({ status: false, verified: false })
  })

  it('me profile 匿名 → 40101（无 Free 装饰，JWT guard 拦截）', async () => {
    const res = await api.anon('GET', api.apiPath('/system/user/me/profile'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })
})

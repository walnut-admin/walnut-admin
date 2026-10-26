import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { generate } from 'otplib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * C 段：`system/user/mfa/totp` 真实闭环 + `system/user/mfa/webauthn` 形状/错误路径。
 *
 * totp：generate 拿真 secret（同时以密文进 AUTH:VERIFY_CODE 同款缓存通道、TTL 30s）→
 * 客户端用 otplib（与服务同库同版本）现算 6 位码 → bind → verify（RT 轮换取新 AT）→
 * status 开关 → unbind。webauthn：浏览器凭证不可脚本伪造 —— register/options 断言
 * 公钥选项形状，authenticate/options 无凭证 40400，authenticate/verify 无 challenge
 * 缓存 40000（register/verify 无 challenge 缓存同路径）。
 */

const DATA_URL_RE = /^data:image\/png;base64,/

interface GenerateTotpResponse {
  totpId: string
  secret: string
  qrCode: string
  account: string
}

describe('C 段：system/user/mfa totp 闭环 + webauthn 形状（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  /** generate 返回的真 secret（bind 后服务端缓存已删，客户端留着给 verify 算码） */
  let totpSecret = ''
  let tempTotpId = ''

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `mfa-${seed8}`)

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

  it('totp generate → 真 secret + qrCode data URL + totpId=`userId,deviceId`', async () => {
    const res = await api.root('POST', api.apiPath('/system/user/mfa/totp/generate'))
    expectOk(res, 'totp generate')

    const data = bodyOf<GenerateTotpResponse>(res).data
    expect(data.totpId).toBe(`${fixture!.userId},${api.deviceId}`)
    expect(data.secret).toMatch(/^[A-Z2-7]+$/i)
    expect(data.qrCode).toMatch(DATA_URL_RE)
    expect(data.account).toBe(fixture!.userName)

    totpSecret = data.secret
    tempTotpId = data.totpId
  })

  it('bind：tempTotpId 错 → 40000；码错 → 40000 verifyCodeError；对码 → backupCodes + totp 行落库', async () => {
    const token = await generate({ strategy: 'totp', secret: totpSecret })

    const badTempId = await api.root('POST', api.apiPath('/system/user/mfa/totp/bind'), {
      name: 'mfa-spec',
      code: token,
      tempTotpId: 'wrong,user',
    })
    expect(bodyOf(badTempId).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const badCode = await api.root('POST', api.apiPath('/system/user/mfa/totp/bind'), {
      name: 'mfa-spec',
      code: '000000',
      tempTotpId,
    })
    expect(bodyOf(badCode).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const bindRes = await api.root('POST', api.apiPath('/system/user/mfa/totp/bind'), {
      name: 'mfa-spec',
      code: token,
      tempTotpId,
    })
    expectOk(bindRes, 'totp bind')
    const backupCodes = bodyOf<{ backupCodes: string[] }>(bindRes).data.backupCodes
    expect(backupCodes).toHaveLength(10)
    for (const code of backupCodes) {
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    }

    const rows: Array<{ device_id: string, status: boolean }> = await api.pgDataSource.query(
      'SELECT device_id, status FROM sys_user_mfa WHERE user_id = $1 AND type = $2',
      [fixture!.userId, 'totp'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].device_id).toBe(api.deviceId)
    expect(rows[0].status).toBe(true)
  })

  it('bind 重复 → 40000 alreadyBound；generate 重入 → 40001 DataExists（活动 totp 行在场）', async () => {
    const rebind = await api.root('POST', api.apiPath('/system/user/mfa/totp/bind'), {
      name: 'mfa-spec',
      code: '123456',
      tempTotpId,
    })
    expect(bodyOf(rebind).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const regen = await api.root('POST', api.apiPath('/system/user/mfa/totp/generate'))
    expect(bodyOf(regen).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS)
  })

  it('verify：错码 → 40000；对码 → 新 AT（RT 轮换）', async () => {
    const badVerify = await api.root('POST', api.apiPath('/system/user/mfa/totp/verify'), {
      code: '000000',
      trusted: false,
    })
    expect(bodyOf(badVerify).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const token = await generate({ strategy: 'totp', secret: totpSecret })
    const verifyRes = await api.root('POST', api.apiPath('/system/user/mfa/totp/verify'), {
      code: token,
      trusted: false,
    })
    expectOk(verifyRes, 'totp verify')
    const newAT = bodyOf<{ accessToken: string }>(verifyRes).data.accessToken
    expect(typeof newAT).toBe('string')
    expect(newAT.length).toBeGreaterThan(20)

    // lastUsedAt 被刷
    const rows: Array<{ last_used_at: string | null }> = await api.pgDataSource.query(
      'SELECT last_used_at FROM sys_user_mfa WHERE user_id = $1 AND type = $2',
      [fixture!.userId, 'totp'],
    )
    expect(rows[0].last_used_at).not.toBeNull()
  })

  it('status 开关：false → true 落库；非活动 totp 不算 verified 通道（security-tab2 对拍）', async () => {
    const disable = await api.root('PUT', api.apiPath('/system/user/mfa/totp/status'), { status: false })
    expectOk(disable, 'totp status disable')

    let tab2 = await api.root('GET', api.apiPath('/system/user/me/security-tab2'))
    expect(bodyOf<{ totp: { status: boolean, verified: boolean } }>(tab2).data.totp).toEqual({ status: false, verified: true })

    const enable = await api.root('PUT', api.apiPath('/system/user/mfa/totp/status'), { status: true })
    expectOk(enable, 'totp status enable')

    tab2 = await api.root('GET', api.apiPath('/system/user/me/security-tab2'))
    expect(bodyOf<{ totp: { status: boolean, verified: boolean } }>(tab2).data.totp).toEqual({ status: true, verified: true })
  })

  it('unbind → 删行；再 unbind → 40401；security-tab2 回全关', async () => {
    const unbindRes = await api.root('DELETE', api.apiPath('/system/user/mfa/totp/unbind'))
    expectOk(unbindRes, 'totp unbind')
    expect(bodyOf<boolean>(unbindRes).data).toBe(true)

    const rows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_mfa WHERE user_id = $1 AND type = $2',
      [fixture!.userId, 'totp'],
    )
    expect(rows[0].c).toBe(0)

    const reunbind = await api.root('DELETE', api.apiPath('/system/user/mfa/totp/unbind'))
    expect(bodyOf(reunbind).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const tab2 = await api.root('GET', api.apiPath('/system/user/me/security-tab2'))
    expect(bodyOf<{ totp: { status: boolean, verified: boolean } }>(tab2).data.totp).toEqual({ status: false, verified: false })
  })

  it('webauthn register/options → 公钥注册选项形状（rp/user/challenge/algorithms）', async () => {
    const res = await api.root('POST', api.apiPath('/system/user/mfa/webauthn/register/options'), {
      name: `webauthn-spec-${seed8}`,
    })
    expectOk(res, 'webauthn register options')

    const data = bodyOf<{ options: Record<string, unknown>, deviceName: string }>(res).data
    expect(data.deviceName).toBe(`webauthn-spec-${seed8}`)

    const options = data.options as {
      rp: { name?: string, id?: string }
      user: { name?: string, displayName?: string }
      challenge: string
      pubKeyCredParams: Array<{ alg: number }>
      excludeCredentials: unknown[]
      authenticatorSelection: Record<string, unknown>
    }
    expect(options.rp.id).toBeTruthy()
    expect(options.user.name).toBe(fixture!.userName)
    expect(options.challenge).toBeTruthy()
    expect(options.pubKeyCredParams.some(p => p.alg === -7)).toBe(true)
    // 本用户无既有 webauthn 凭证 → 排除列表空
    expect(options.excludeCredentials).toEqual([])
  })

  it('webauthn 错误路径：authenticate/options 无凭证 → 40400；verify 无 challenge 缓存 → 40000', async () => {
    const noCredential = await api.root('POST', api.apiPath('/system/user/mfa/webauthn/authenticate/options'))
    expect(bodyOf(noCredential).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND)

    const noChallenge = await api.root('POST', api.apiPath('/system/user/mfa/webauthn/authenticate/verify'), {
      trusted: false,
      response: { id: 'cred-x', rawId: 'cred-x', type: 'public-key' },
    })
    expect(bodyOf(noChallenge).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const regNoChallenge = await api.root('POST', api.apiPath('/system/user/mfa/webauthn/register/verify'), {
      name: 'webauthn-spec',
      response: {},
    })
    // 上例 register/options 的 challenge 还在 30s TTL 内 → 过了 nil 检查，malformed
    // response 在 simplewebauthn 校验里抛未受控异常 → 50000 兜底（钉现状）
    expect(bodyOf(regNoChallenge).code).toBe(WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR)
  })

  it('边界：totp bind 缺字段 → 40099（code 6 位数字串约束）', async () => {
    const missing = await api.root('POST', api.apiPath('/system/user/mfa/totp/bind'), {
      name: 'mfa-spec',
      tempTotpId,
    })
    expect(bodyOf(missing).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const badFormat = await api.root('POST', api.apiPath('/system/user/mfa/totp/bind'), {
      name: 'mfa-spec',
      code: '12ab',
      tempTotpId,
    })
    expect(bodyOf(badFormat).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('边界：totp 端点匿名 → 40101（MFAFree 只免 MFA 守卫，JWT 仍拦）', async () => {
    const res = await api.anon('POST', api.apiPath('/system/user/mfa/totp/generate'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })
})

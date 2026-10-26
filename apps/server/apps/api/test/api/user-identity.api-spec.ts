import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppTechCacheVerifyCodeService } from '@/modules/techniques/cache/service/cache.verifyCode'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * C 段：`system/user/identity` 的 `/:type/:purpose` 系 —— status / check→bind（OTP 真实
 * 闭环：check 经 Bull 队列投递邮件任务但不真发（测试环境无 worker），验证码落在
 * AUTH:VERIFY_CODE 缓存，用例从真实缓存通道读回）/ unbind / update / verify /
 * send-code / update-status。
 *
 * 钉现状（非迁移回归，登记 ENDPOINTS.md）：
 * - `POST list` 恒 40099 —— list DTO 是空类（SysUserIdentityListDTO），全局 ValidationPipe
 *   的 forbidUnknownValues 对无校验元数据的类体恒抛 "an unknown value..."，带不带 body
 *   都一样 —— 该端点经 HTTP 不可用（身份读腿走 status 端点）；
 * - bind 的 setAsSecurity 未挂 IsOptional：body 缺该字段 → 40099（"should not be empty"），
 *   swagger 的 default:false 不豁免校验。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface IdentityStatus {
  password: { set: boolean, lastChanged: string }
  phoneNumber: { bound: boolean, maskedValue: string | null, verified: boolean, status: boolean }
  emailAddress: { bound: boolean, maskedValue: string | null, verified: boolean, status: boolean }
}

describe('C 段：system/user/identity 状态机（check/bind/verify/unbind）（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  /** 第二个 root 用户（value 已占用的冲突路径用） */
  let apiB: WalnutApiClient
  let fixture: WalnutRootUserFixture | null = null
  let fixtureB: WalnutRootUserFixture | null = null

  const seed8 = randomUUID().slice(0, 8)
  const emailOf = (tag: string) => `identity-${seed8}-${tag}@example.com`
  let verifyCodeService: AppTechCacheVerifyCodeService

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    verifyCodeService = app.get(AppTechCacheVerifyCodeService)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `uid-a-${seed8}`)
    fixtureB = await registerRootUserFixture(app, api.pgDataSource, `uid-b-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // 第二客户端 + 第二登录（value 占用冲突的请求方）
    apiB = await WalnutApiClient.create(app)
    const tokensB = await performHttpOpaqueLogin(apiB, app, fixtureB)
    apiB.setAuth(tokensB)
    await apiB.seedMfaVerifiedCache(fixtureB.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null && fixtureB !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user_identity WHERE user_id = ANY($1::uuid[])', [[fixture.userId, fixtureB.userId]])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = ANY($1::uuid[])', [[fixture.userId, fixtureB.userId]])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [[api.deviceId, apiB.deviceId]])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, apiB.deviceId, fixture.userId, fixtureB.userId)
    }
    await app.close()
  })

  it('status/login 初始形态：password set=true（opaque 注册落的身份）、email/phone 未绑定', async () => {
    const res = await api.root('GET', api.apiPath('/system/user/identity/status/login'))
    expectOk(res, 'identity status login')

    const data = bodyOf<IdentityStatus>(res).data
    expect(data.password.set).toBe(true)
    expect(data.emailAddress).toEqual({ bound: false, maskedValue: null, verified: false, status: false })
    expect(data.phoneNumber).toEqual({ bound: false, maskedValue: null, verified: false, status: false })

    const statusSecurity = await api.root('GET', api.apiPath('/system/user/identity/status/security'))
    expectOk(statusSecurity, 'identity status security')
    expect(bodyOf<IdentityStatus>(statusSecurity).data.emailAddress.bound).toBe(false)
  })

  it('check → 20000 + 验证码落 AUTH:VERIFY_CODE 缓存（邮件任务进队列不真发）', async () => {
    const email = emailOf('bind')
    const res = await api.root('POST', api.apiPath('/system/user/identity/check/emailAddress/login'), {
      identifier: email,
    })
    expectOk(res, 'identity check')
    expect(bodyOf<boolean>(res).data).toBe(true)

    const code = await verifyCodeService.getVerifyCodeForAuthUserCache(fixture!.userId, email)
    expect(code).not.toBeNull()
    expect(String(code)).toMatch(/^\d{4,8}$/)
  })

  it('bind：错码 → 40000 verifyCodeError（不成行）；缺 setAsSecurity → 40099；对码 → security 身份同落', async () => {
    const email = emailOf('bind')
    // 上一用例已 check 过，缓存里有真码；这里故意错 —— bind 失败不成行
    const badBind = await api.root('POST', api.apiPath('/system/user/identity/bind/emailAddress/login'), {
      identifier: email,
      verifyCode: '000000',
      setAsSecurity: false,
    })
    expect(bodyOf(badBind).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    // 失败后 value 仍可 check（重发新码，缓存被刷新）
    const recheck = await api.root('POST', api.apiPath('/system/user/identity/check/emailAddress/login'), {
      identifier: email,
    })
    expectOk(recheck, 'identity recheck after failed bind')

    // 缺 setAsSecurity：IsBoolean+IsNotEmpty 且无 IsOptional → 40099（钉现状）
    const missingFlag = await api.root('POST', api.apiPath('/system/user/identity/bind/emailAddress/login'), {
      identifier: email,
      verifyCode: String(await verifyCodeService.getVerifyCodeForAuthUserCache(fixture!.userId, email)),
    })
    expect(bodyOf(missingFlag).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    // 把真码拿出来走正常 bind
    const bindRes = await api.root('POST', api.apiPath('/system/user/identity/bind/emailAddress/login'), {
      identifier: email,
      verifyCode: String(await verifyCodeService.getVerifyCodeForAuthUserCache(fixture!.userId, email)),
      setAsSecurity: true,
    })
    expectOk(bindRes, 'identity bind')
    expect(bodyOf<boolean>(bindRes).data).toBe(true)

    // setAsSecurity + login purpose → security 身份同值落第二行
    const securityRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'security'],
    )
    expect(securityRows[0].c).toBe(1)

    // 绑定成功后再 check → 40000 identityAlreadyBound（自身已绑定）
    const alreadyBound = await api.root('POST', api.apiPath('/system/user/identity/check/emailAddress/login'), {
      identifier: email,
    })
    expect(bodyOf(alreadyBound).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('status 回 bound=true + maskedValue（首字符+星号+末字符@domain）；行 id 形状（uuid）', async () => {
    const email = emailOf('bind')
    const statusRes = await api.root('GET', api.apiPath('/system/user/identity/status/login'))
    const status = bodyOf<IdentityStatus>(statusRes).data
    expect(status.emailAddress.bound).toBe(true)
    expect(status.emailAddress.verified).toBe(true)
    expect(status.emailAddress.status).toBe(true)
    // 掩码形态：local 首字符 + (len-2) 个星号 + local 末字符 @ domain
    const local = email.split('@')[0]
    expect(status.emailAddress.maskedValue).toBe(`${local[0]}${'*'.repeat(local.length - 2)}${local.at(-1)}@example.com`)

    const rows: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'login'],
    )
    expect(rows[0].id).toMatch(UUID_RE)
  })

  it('POST list 恒 40099（空 DTO × forbidUnknownValues，钉现状不修）', async () => {
    const withBody = await api.root('POST', api.apiPath('/system/user/identity/list'), {})
    expect(bodyOf(withBody).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect((bodyOf(withBody) as unknown as { _devMsg?: string })._devMsg).toContain('unknown value')

    const noBody = await api.root('POST', api.apiPath('/system/user/identity/list'))
    expect(bodyOf(noBody).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('value 已被他人占用 → 另一用户 check 40000 identityAlreadyUsed；bind 同样拦', async () => {
    const email = emailOf('bind')

    const checkRes = await apiB.root('POST', apiB.apiPath('/system/user/identity/check/emailAddress/login'), {
      identifier: email,
    })
    expect(bodyOf(checkRes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const bindRes = await apiB.root('POST', apiB.apiPath('/system/user/identity/bind/emailAddress/login'), {
      identifier: email,
      verifyCode: '123456',
      setAsSecurity: false,
    })
    expect(bodyOf(bindRes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('update（rebind）经 HTTP 恒 40000（钉现状不修）', async () => {
    const newEmail = emailOf('bind2')
    // update DTO 是 partial 类，ValidationPipe 把未给键以显式 null 材料化 —— 服务端
    // `verified !== undefined` 判 null 也命中 → useVerifyEndpoint 拦截，任何 body 都到不了
    // 改值逻辑（带 verified 更是显式拒绝）。改值走 verify 端点的链路由下例用 SQL 制造
    // 未验证态后覆盖。
    const valueOnly = await api.root('PUT', api.apiPath('/system/user/identity/update/emailAddress/login'), {
      value: newEmail,
    })
    expect(bodyOf(valueOnly).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect((bodyOf(valueOnly) as unknown as { _devMsg?: string })._devMsg).toBe('business.auth.useVerifyEndpoint')

    const withVerified = await api.root('PUT', api.apiPath('/system/user/identity/update/emailAddress/login'), {
      value: newEmail,
      verified: true,
    })
    expect(bodyOf(withVerified).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const rows: Array<{ value: string | null, verified: boolean }> = await api.pgDataSource.query(
      'SELECT value, verified FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'login'],
    )
    expect(rows[0].verified).toBe(true)
  })

  it('send-code/verify 闭环：未验证态（SQL 制造）→ 码进缓存 → 错码 40000 → 对码 verified=true', async () => {
    // update 端点经 HTTP 不可用（上例钉现状）—— 未验证态按真实列语义 SQL 制造
    await api.pgDataSource.query(
      'UPDATE sys_user_identity SET verified = false, verified_at = NULL WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'login'],
    )

    const sendRes = await api.root('POST', api.apiPath('/system/user/identity/send-code/emailAddress/login'))
    expectOk(sendRes, 'identity send-code')

    // send-code 解密的是行上现值（原始 identifier）
    const code = await verifyCodeService.getVerifyCodeForAuthUserCache(fixture!.userId, emailOf('bind'))
    expect(code).not.toBeNull()

    const badVerify = await api.root('POST', api.apiPath('/system/user/identity/verify/emailAddress/login'), {
      verifyCode: '000000',
    })
    expect(bodyOf(badVerify).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const verifyRes = await api.root('POST', api.apiPath('/system/user/identity/verify/emailAddress/login'), {
      verifyCode: String(code),
    })
    expectOk(verifyRes, 'identity verify')

    const rows: Array<{ verified: boolean }> = await api.pgDataSource.query(
      'SELECT verified FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'login'],
    )
    expect(rows[0].verified).toBe(true)
  })

  it('update-status → 40401（钉现状）：守卫的可用验证方式探测对缺失身份直接抛 DataNotFound', async () => {
    // phoneNumber/security 身份直接 getIdentityOrThrow → DataNotFound 在守卫链上抛出，
    // 预期的 40119（UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED）分支不可达
    const res = await api.root('PUT', api.apiPath('/system/user/identity/status/emailAddress/login'), {
      status: false,
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  })

  it('unbind → 删行；status 回未绑定；再 unbind → 40401', async () => {
    const unbindRes = await api.root('DELETE', api.apiPath('/system/user/identity/unbind/emailAddress/login'))
    expectOk(unbindRes, 'identity unbind login')

    const rows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'login'],
    )
    expect(rows[0].c).toBe(0)

    const statusRes = await api.root('GET', api.apiPath('/system/user/identity/status/login'))
    expect(bodyOf<IdentityStatus>(statusRes).data.emailAddress.bound).toBe(false)

    const reunbind = await api.root('DELETE', api.apiPath('/system/user/identity/unbind/emailAddress/login'))
    expect(bodyOf(reunbind).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  })

  it('参数守卫：非法 purpose 枚举 → 40099', async () => {
    const res = await api.root('GET', api.apiPath('/system/user/identity/status/unknown-purpose'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

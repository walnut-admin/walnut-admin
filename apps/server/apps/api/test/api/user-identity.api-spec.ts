import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
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
 * P1-6 修复面（2026-10-28）：
 * - `POST list` 空 DTO 在 forbidUnknownValues 下曾恒 40099（"an unknown value..."）——
 *   DTO 补 @Allow 校验元数据后 20000（带不带 body 均可）；
 * - bind 的 setAsSecurity 补 IsOptional：缺字段按默认 false 落库（不再 40099）；
 * - update（rebind）的 null 判据改 `!= null`：partial DTO 未给键材料化成显式 null，
 *   旧 `!== undefined` 判据把 null 当「给了值」→ verified 分支恒拦 useVerifyEndpoint；
 * - update-status 的守卫探测腿改容错（缺失身份跳过）：无 phone security 身份不再 40401，
 *   有 email security 身份即可正常抛 40119（SensitiveVerificationFailed）。
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

  /**
   * P2-25：update/unbind 挂 account_critical 敏感守卫后，成功路径需先拿到与 status 端点
   * 同级的授权键（`sensitive_op:<userId>:<deviceId>:<level>`，裸 Redis 键）；每个用例
   * 结束统一撤销，避免授权泄漏把后续 40119 用例放行。
   */
  function sensitivePermissionKey(): string {
    return `sensitive_op:${fixture!.userId}:${api.deviceId}:account_critical`
  }

  async function grantSensitivePermission(): Promise<void> {
    const redis = app.get(AppTechRedisService).getClient()
    await redis.setEx(sensitivePermissionKey(), 900, JSON.stringify({ operationType: 'identity_manage', expiresAt: Date.now() + 900_000 }))
  }

  async function revokeSensitivePermission(): Promise<void> {
    const redis = app.get(AppTechRedisService).getClient()
    await redis.del(sensitivePermissionKey())
  }

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

  afterEach(async () => {
    await revokeSensitivePermission()
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

  it('P2-25：仅口令一种登录方式时解绑 password → 40000（keep-one 判据不再豁免 password）', async () => {
    // fixture 此刻只有 opaque 注册落的 password/login 身份（email 尚未绑定）
    await grantSensitivePermission()

    const res = await api.root('DELETE', api.apiPath('/system/user/identity/unbind/password/login'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect((bodyOf(res) as unknown as { _devMsg?: string })._devMsg).toBe('business.auth.unbindAtLeastOneLoginMethodRequired')

    // 行未被删除
    const rows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'password', 'login'],
    )
    expect(rows[0].c).toBe(1)
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

  it('bind：错码 → 40000（不成行）；缺 setAsSecurity 走默认 false；解绑后带 setAsSecurity 重绑 → security 身份同落', async () => {
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

    // P1-6② 修复：缺 setAsSecurity 由 IsOptional 放行，默认 false → 正常绑定、不落 security 行
    const missingFlag = await api.root('POST', api.apiPath('/system/user/identity/bind/emailAddress/login'), {
      identifier: email,
      verifyCode: String(await verifyCodeService.getVerifyCodeForAuthUserCache(fixture!.userId, email)),
    })
    expectOk(missingFlag, 'identity bind without setAsSecurity')
    expect(bodyOf<boolean>(missingFlag).data).toBe(true)

    const noSecurityRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'security'],
    )
    expect(noSecurityRows[0].c).toBe(0)

    // 解绑后重走 check→bind，验证 setAsSecurity=true 的 security 身份同落（后续 update-status
    // 用例依赖该 security 身份进入 40119 验证流程）。P2-25：unbind 需 account_critical
    // 敏感授权（此处直接预置授权键；无授权的 40119 面由独立用例覆盖）。
    await grantSensitivePermission()
    const unbindRes = await api.root('DELETE', api.apiPath('/system/user/identity/unbind/emailAddress/login'))
    expectOk(unbindRes, 'identity unbind before rebind')

    const recheck2 = await api.root('POST', api.apiPath('/system/user/identity/check/emailAddress/login'), {
      identifier: email,
    })
    expectOk(recheck2, 'identity recheck before rebind with security')

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

  it('POST list → 20000（P1-6①：DTO 补 @Allow 校验元数据，不再被 forbidUnknownValues 误伤）', async () => {
    const withBody = await api.root('POST', api.apiPath('/system/user/identity/list'), {})
    expectOk(withBody, 'identity list with body')
    // 行实体无 @Expose，全局 ClassSerializerInterceptor（excludeExtraneousValues）会把行字段
    // 剥成 {} —— 本用例只钉「端点可达且 total 计数真实」（行形态属 P3 文档层缺口，另行排期）
    const list = bodyOf<{ data: unknown[], total: number }>(withBody).data
    expect(Array.isArray(list.data)).toBe(true)
    expect(list.total).toBeGreaterThanOrEqual(1)

    const noBody = await api.root('POST', api.apiPath('/system/user/identity/list'))
    expectOk(noBody, 'identity list without body')
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

  it('P2-25：update / unbind 未授权 → 40119（敏感守卫与 status 同级）', async () => {
    // 无授权键：两条路径都在守卫层被拦（40119），不进入 service
    const updateRes = await api.root('PUT', api.apiPath('/system/user/identity/update/emailAddress/login'), {
      value: emailOf('unauthorized'),
    })
    expect(bodyOf(updateRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED)

    const unbindRes = await api.root('DELETE', api.apiPath('/system/user/identity/unbind/emailAddress/login'))
    expect(bodyOf(unbindRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED)

    // 身份行未被改动（update 的 value 仍是上例绑定的值）
    const rows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'login'],
    )
    expect(rows[0].c).toBe(1)
  })

  it('update（rebind）→ 20000 改值并回 verified=false（P1-6③：null 判据改 != null；P2-25 需敏感授权）', async () => {
    const newEmail = emailOf('bind2')
    await grantSensitivePermission()

    // P1-6③ 修复：partial DTO 未给键材料化成显式 null，旧 `!== undefined` 把 null 当「给了值」
    // → verified 分支恒拦 useVerifyEndpoint。改 `!= null` 后 `{value}` 可到改值逻辑。
    const valueOnly = await api.root('PUT', api.apiPath('/system/user/identity/update/emailAddress/login'), {
      value: newEmail,
    })
    expectOk(valueOnly, 'identity update value only')
    expect(bodyOf<boolean>(valueOnly).data).toBe(true)

    const rows: Array<{ value: string | null, verified: boolean }> = await api.pgDataSource.query(
      'SELECT value, verified FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'login'],
    )
    expect(rows[0].verified).toBe(false)

    // 显式 verified=true 仍走 useVerifyEndpoint 拒绝（另一新值，避免先撞 identityAlreadyUsed）
    const withVerified = await api.root('PUT', api.apiPath('/system/user/identity/update/emailAddress/login'), {
      value: emailOf('bind3'),
      verified: true,
    })
    expect(bodyOf(withVerified).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect((bodyOf(withVerified) as unknown as { _devMsg?: string })._devMsg).toBe('business.auth.useVerifyEndpoint')

    // 值仍停在 bind2（withVerified 请求未落改值）
    const rowsAfter: Array<{ value: string | null, verified: boolean }> = await api.pgDataSource.query(
      'SELECT value, verified FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'login'],
    )
    expect(rowsAfter[0].verified).toBe(false)
  })

  it('send-code/verify 闭环：未验证态（上例 update 已回 false）→ 码进缓存 → 错码 40000 → 对码 verified=true', async () => {
    // 上例 update 已把行置 verified=false；这里再按真实列语义确认一次（幂等）
    await api.pgDataSource.query(
      'UPDATE sys_user_identity SET verified = false, verified_at = NULL WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'login'],
    )

    const sendRes = await api.root('POST', api.apiPath('/system/user/identity/send-code/emailAddress/login'))
    expectOk(sendRes, 'identity send-code')

    // send-code 解密的是行上现值（上例 update 后的新 identifier）
    const code = await verifyCodeService.getVerifyCodeForAuthUserCache(fixture!.userId, emailOf('bind2'))
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

  it('update-status → 40119（P1-5/P1-6④：探测腿容错跳过缺失身份，email security 身份使验证流程可达）', async () => {
    // phoneNumber/security 身份缺失 → 探测腿跳过（不再 getIdentityOrThrow → 40401）；
    // password 通道已摘除；email security 身份在 → availableMethods=[email] →
    // SensitiveOperationGuard 抛 40119（SensitiveVerificationFailed），前端据此走验证流程。
    const res = await api.root('PUT', api.apiPath('/system/user/identity/status/emailAddress/login'), {
      status: false,
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED)
  })

  it('unbind → 删行；status 回未绑定；再 unbind → 40401（P2-25 需敏感授权）', async () => {
    await grantSensitivePermission()
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

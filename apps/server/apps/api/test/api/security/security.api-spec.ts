import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from '../helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { AppTechCacheVerifyCodeService, AppTechRedisService } from '@walnut-server/cache'
import { SysUserIdentitySharedService } from '@walnut-server/identity'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../helpers/auth-login'
import { createApiApp } from '../helpers/create-api-app'
import { solveCapChallenge } from '../helpers/sign-handshake'

/**
 * D 段：`security` 系（真实 HTTP 全链）。sign 两步握手由 helpers（api-client 引导）
 * 常态覆盖 —— 本文件补：
 *
 * - `GET /security/rsa/public-key`：Sign/Jwt/Cap 全 Free（Device guard 仍在）——
 *   返回 app_key 表 current RSA_PAIR（version 最大 ACTIVE 行）的 meta.publicKeyPem；
 *   用例自插高 version 目标行做数据自洽（与 app_key.int-spec / key.api-spec 双向隔离），
 *   afterAll 清行还原；
 * - `POST /security/cap/challenge` + `/redeem`：FreeResponse 无响应壳 —— challenge 回
 *   cap.js `{challenge:{c,s,d},token,expires}`，redeem 本地 PoW 求解后 `{success:true,...}`
 *   （helpers 的求解器再走一遍，钉 challenge/redeem 语义）；错解 → success:false；
 * - `GET /security/sensitive/check` + `POST /security/sensitive/verify`（P1-5 修复面）：
 *   ① 缺 security 身份的用户 → 探测腿容错跳过（不再 40401），无任何可用方式 → 受控
 *   40000（business.auth.noVerifyMethodAvailable）；
 *   ② 造 security email/phone 身份后 check 列出 sms/email（password 通道已摘除）、首选 sms；
 *   ③ verify email 通道对码 → 授权（sensitive_op:* 键）→ check 翻转 needsVerification=false；
 *   ④ password 通道不可用（已从 availableMethods 摘除）→ 40000 verifyMethodNotAllowed；
 *   ⑤ 错码 → 40000 且不授权。
 */

interface CapChallengeBody {
  challenge: { c: number, s: number, d: number }
  token: string
  expires: number
}

/** 短轮询：sensitive_op 授权键出现/消失（grant 是同步写，轮询仅兜 fire-and-forget 时序） */
async function pollUntil(fn: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  expect(await fn()).toBe(true)
}

describe('D 段：security rsa/public-key + cap challenge/redeem + sensitive check/verify（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  let securityEmail = ''
  /** 自插的高 version RSA_PAIR 目标行（afterAll 清，还原 app_key 现场） */
  const seededKeyIds: string[] = []
  let verifyCodeService: AppTechCacheVerifyCodeService

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    verifyCodeService = app.get(AppTechCacheVerifyCodeService)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `security-${seed8}`)
    securityEmail = `security-${seed8}@walnut.local`

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      // 自插 app_key 行清场（restore：清掉后 current 回到进入前的 max version 行）
      for (const id of seededKeyIds) {
        await api.pgDataSource.query('DELETE FROM app_key WHERE id = $1', [id])
      }
      // sensitive 授权键（裸 Redis 键，无 WALNUT_CACHE_ 前缀，逐键显式清）
      const redis = app.get(AppTechRedisService).getClient()
      await redis.del(`sensitive_op:${fixture.userId}:${api.deviceId}:basic`)
      await redis.del(`sensitive_op:${fixture.userId}:${api.deviceId}:account_critical`)
      await api.pgDataSource.query('DELETE FROM sys_user_identity WHERE user_id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId, securityEmail)
    }
    await app.close()
  })

  it('rsa/public-key → 与 app_key 表 current RSA_PAIR 行（自插高 version）的 publicKeyPem 一致', async () => {
    // 数据自洽：插一行 version 远高于现网 max 的 ACTIVE RSA_PAIR（PEM 用真实格式占位即可，
    // 端点只回读 meta.publicKeyPem 字符串，不做密码学校验）
    const maxRows: Array<{ max_version: number }> = await api.pgDataSource.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version FROM app_key WHERE type = 'RSA_PAIR'`,
    )
    const highVersion = Number(maxRows[0].max_version) + 1000
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\nsecurity-spec-${seed8}\n-----END PUBLIC KEY-----`
    const inserted: Array<{ id: string }> = await api.pgDataSource.query(
      `INSERT INTO app_key (key, type, version, status, valid_start, meta)
       VALUES ($1, 'RSA_PAIR', $2, 'ACTIVE', now(), $3::jsonb)
       RETURNING id`,
      [`security-spec-${seed8}`, highVersion, JSON.stringify({ publicKeyPem, privateKeyPem: 'unused' })],
    )
    seededKeyIds.push(inserted[0].id)

    const res = await api.root('GET', api.apiPath('/security/rsa/public-key'))
    expectOk(res, 'security rsa public-key')
    expect(bodyOf<string>(res).data).toBe(publicKeyPem)
  })

  it('cap challenge/redeem → FreeResponse 无响应壳：challenge 形状 + 本地 PoW 对解 success:true', async () => {
    const challengeRes = await api.anon('POST', api.apiPath('/security/cap/challenge'))
    // FreeResponse：body 即 cap.js 形态（无 {code,data} 壳）
    const challengeBody = challengeRes.body as CapChallengeBody
    expect(challengeBody.challenge.c).toBeGreaterThan(0)
    expect(challengeBody.challenge.s).toBeGreaterThan(0)
    expect(challengeBody.challenge.d).toBeGreaterThan(0)
    expect(typeof challengeBody.token).toBe('string')
    expect(challengeBody.expires).toBeGreaterThan(Date.now())

    const solutions = solveCapChallenge(challengeBody.challenge, challengeBody.token)
    const redeemRes = await api.anon('POST', api.apiPath('/security/cap/redeem'), {
      token: challengeBody.token,
      solutions,
    })
    const redeemBody = redeemRes.body as { success?: boolean, token?: string, expires?: number }
    expect(redeemBody.success).toBe(true)
    expect(typeof redeemBody.token).toBe('string')
    expect(redeemBody.expires).toBeGreaterThan(Date.now())
  })

  it('cap redeem 错解 → FreeResponse success:false', async () => {
    const challengeRes = await api.anon('POST', api.apiPath('/security/cap/challenge'))
    const challengeBody = challengeRes.body as CapChallengeBody

    const redeemRes = await api.anon('POST', api.apiPath('/security/cap/redeem'), {
      token: challengeBody.token,
      solutions: challengeBody.challenge.c > 0 ? [999999] : [1],
    })
    const redeemBody = redeemRes.body as { success?: boolean, message?: string }
    expect(redeemBody.success).toBe(false)
  })

  it('sensitive check（无 security 身份）→ 40000（P1-5：探测腿容错跳过，无可用方式走受控 noVerifyMethodAvailable）', async () => {
    const res = await api.root('GET', api.apiPath('/security/sensitive/check?level=basic'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect((bodyOf(res) as unknown as { _devMsg?: string })._devMsg).toBe('business.auth.noVerifyMethodAvailable')
  })

  it('sensitive check 枚举外 level/type → 40099（管道闸：修复前裸 query 直进 getOperationStrategy 解引用 undefined → 兜底 50000）', async () => {
    const bogusLevel = await api.root('GET', api.apiPath('/security/sensitive/check?level=bogus'))
    expect(bodyOf(bogusLevel).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    // 可选 type 给了值也要过枚举（缺省不传仍放行 —— 下一用例的 level=basic 无 type 即该形态）
    const bogusType = await api.root('GET', api.apiPath('/security/sensitive/check?level=basic&type=bogus'))
    expect(bodyOf(bogusType).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('造 security email/phone 身份后 check → needsVerification + availableMethods(sms/email，password 已摘除) + 首选 sms', async () => {
    // 探测腿容错后单腿即可（email 一处）；phone 一并造出以覆盖 SMS 方式的列表
    const identityShared = app.get(SysUserIdentitySharedService)
    await identityShared.createIdentity(fixture!.userId, 'emailAddress', 'security', securityEmail)
    await identityShared.verifyIdentity(fixture!.userId, 'emailAddress', 'security')
    await identityShared.createIdentity(fixture!.userId, 'phoneNumber', 'security', `138${seed8.replaceAll('-', '').slice(0, 8)}`)
    await identityShared.verifyIdentity(fixture!.userId, 'phoneNumber', 'security')

    const res = await api.root('GET', api.apiPath('/security/sensitive/check?level=basic'))
    expectOk(res, 'sensitive check')

    const data = bodyOf<{ needsVerification: boolean, availableMethods?: string[], preferredMethod?: string }>(res).data
    expect(data.needsVerification).toBe(true)
    // P1-5：password 通道摘除（identity value 是 opaque record，无法明文比对）
    expect(data.availableMethods).not.toContain('password')
    expect(data.availableMethods).toContain('sms')
    expect(data.availableMethods).toContain('email')
    // mfa 校验未实现，恒不列（B7c 钉现状）
    expect(data.availableMethods).not.toContain('mfa')
    expect(data.preferredMethod).toBe('sms')
  })

  it('sensitive verify：password 通道不可用 → 40000（P1-5：已从可用方式摘除，闸口 verifyMethodNotAllowed）', async () => {
    const res = await api.root('POST', api.apiPath('/security/sensitive/verify'), {
      level: 'basic',
      operationType: 'password_change',
      method: 'password',
      credential: fixture!.password,
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect((bodyOf(res) as unknown as { _devMsg?: string })._devMsg).toBe('business.auth.verifyMethodNotAllowed')

    const redis = app.get(AppTechRedisService).getClient()
    expect(await redis.exists(`sensitive_op:${fixture!.userId}:${api.deviceId}:basic`)).toBe(0)
  })

  it('sensitive verify email 错码 → 40000 且不授权', async () => {
    await verifyCodeService.setVerifyCodeForAuthUserCache(fixture!.userId, securityEmail, 456789, 300)

    const res = await api.root('POST', api.apiPath('/security/sensitive/verify'), {
      level: 'basic',
      operationType: 'password_change',
      method: 'email',
      credential: '111222',
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const redis = app.get(AppTechRedisService).getClient()
    expect(await redis.exists(`sensitive_op:${fixture!.userId}:${api.deviceId}:basic`)).toBe(0)
  })

  it('sensitive verify email 对码 → true + 授权键落 Redis；check 翻转 needsVerification=false + remainingSeconds', async () => {
    await verifyCodeService.setVerifyCodeForAuthUserCache(fixture!.userId, securityEmail, 778899, 300)

    const res = await api.root('POST', api.apiPath('/security/sensitive/verify'), {
      level: 'basic',
      operationType: 'password_change',
      method: 'email',
      credential: '778899',
    })
    expectOk(res, 'sensitive verify')
    expect(bodyOf<boolean>(res).data).toBe(true)

    const redis = app.get(AppTechRedisService).getClient()
    await pollUntil(async () => (await redis.exists(`sensitive_op:${fixture!.userId}:${api.deviceId}:basic`)) === 1)

    const checkRes = await api.root('GET', api.apiPath('/security/sensitive/check?level=basic'))
    expectOk(checkRes, 'sensitive check after grant')
    const granted = bodyOf<{ needsVerification: boolean, remainingSeconds?: number }>(checkRes).data
    expect(granted.needsVerification).toBe(false)
    expect(granted.remainingSeconds).toBeGreaterThan(0)
  })

  it('sensitive verify 参数面：method 不在支持面（mfa 未实现）→ 40000 verifyMethodNotAllowed', async () => {
    const res = await api.root('POST', api.apiPath('/security/sensitive/verify'), {
      level: 'basic',
      operationType: 'password_change',
      method: 'mfa',
      credential: '000000',
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('G6 授权按 level 生效：basic 已授权不放行 account_critical；verify account_critical 后受控端点 20000', async () => {
    const redis = app.get(AppTechRedisService).getClient()
    const criticalKey = `sensitive_op:${fixture!.userId}:${api.deviceId}:account_critical`

    // 前置：本文件前面的用例只在 basic 级授权；account_critical 键不存在
    expect(await redis.exists(criticalKey)).toBe(0)

    // ① level 隔离：basic 的授权键不能让 account_critical 守卫放行 —— 40119 且 meta 带可验证面
    //    （identity status 的 operationType=email_status_toggle 策略覆盖为 EMAIL 通道）
    const denied = await api.root('PUT', api.apiPath('/system/user/identity/status/emailAddress/security'), {
      status: false,
    })
    expect(bodyOf(denied).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED)

    // ② verify account_critical（email 对码）→ 授权键落在 account_critical 级
    await verifyCodeService.setVerifyCodeForAuthUserCache(fixture!.userId, securityEmail, 667788, 300)
    const verifyRes = await api.root('POST', api.apiPath('/security/sensitive/verify'), {
      level: 'account_critical',
      operationType: 'email_status_toggle',
      method: 'email',
      credential: '667788',
    })
    expectOk(verifyRes, 'sensitive verify account_critical')
    await pollUntil(async () => (await redis.exists(criticalKey)) === 1)

    // ③ 回打挂 RequireSensitive(account_critical) 的端点 → 20000，且业务腿真实执行（status=false 落库）
    const okRes = await api.root('PUT', api.apiPath('/system/user/identity/status/emailAddress/security'), {
      status: false,
    })
    expectOk(okRes, 'identity status with account_critical grant')

    const identityRows: Array<{ status: boolean }> = await api.pgDataSource.query(
      'SELECT status FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [fixture!.userId, 'emailAddress', 'security'],
    )
    expect(identityRows[0].status).toBe(false)
  })
})

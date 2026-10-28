import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'

import * as opaque from '@serenity-kit/opaque'
import { WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { DBTransactionHooksStore } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionInvalidCredential, WalnutAdminExceptionSignupBanned } from '@walnut-server/exceptions/business/auth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AuthMfaService } from '@/modules/auth/modules/mfa/mfa.service'
import { OAuthGiteeService } from '@/modules/auth/modules/oauth/gitee/gitee.service'
import { OAuthGitHubService } from '@/modules/auth/modules/oauth/github/github.service'
import { AuthOpaqueCoreService } from '@/modules/auth/modules/opaque/core/opaque.core.service'
import { AuthOpaqueUserService } from '@/modules/auth/modules/opaque/user/opaque.user.service'
import { OtpService } from '@/modules/auth/modules/otp/otp.service'
import { OtpSharedService } from '@/modules/auth/modules/otp/shared/otp.shared.service'
import { AuthRefreshSharedService } from '@/modules/auth/modules/refresh/shared/refresh.shared.service'
import { AuthSharedService } from '@/modules/auth/modules/shared/shared.service'
import { AuthSignoutService } from '@/modules/auth/modules/signout/signout.service'
import { SecurityRiskDeviceService } from '@/modules/security/risk/modules/device.service'
import { SecurityRiskFailedLoginService } from '@/modules/security/risk/modules/failedLogin.service'
import { SecurityRiskIPService } from '@/modules/security/risk/modules/ip.service'
import { SecurityRiskUserService } from '@/modules/security/risk/modules/user.service'
import { SecuritySensitiveService } from '@/modules/security/sensitive/sensitive.service'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import { SysUserIdentityRepositoryService } from '@/modules/system/user_identity/repo/user_identity.repo.service'
import { SysUserIdentitySharedService } from '@/modules/system/user_identity/shared/user_identity.shared.service'
import { SysUserOAuthRepositoryService } from '@/modules/system/user_oauth/repo/user_oauth.repo.service'
import { AppTechRedisService } from '@/modules/techniques/cache/redis/redis.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { AppTechCacheMfaService } from '@/modules/techniques/cache/service/cache.mfa'
import { AppTechCacheVerifyCodeService } from '@/modules/techniques/cache/service/cache.verifyCode'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'

/**
 * B7c 登录全链用例（phase3-plan §1 B7c，on real PG）—— auth 链 + security 收口后的
 * 端到端对账基准：
 *
 * - **登录/注册事务原子性（B7 核心验收）**：
 *   P1-14（2026-10-28）后 register 端点语义为「已登录用户补挂口令」——
 *   `finishRegister(userId, record)` 只 upsert password identity（单腿，挂调用方 em）；
 *   新用户由 `createForAuthUser` 建立（测试 fixture 走同一真实写腿）；
 *   登录（generateAuthTokens：refresh + user_device 联动腿同 em —— B7c 把
 *   bindDeviceForUser 收进事务后，登录事务内不再有事务外写腿）；
 * - opaque 全链（真实 crypto 栈：客户端 fixture 按服务真实用法走
 *   @serenity-kit/opaque 的 client 流程，identifiers 双端一致，serverSetup / app.name
 *   与服务同源配置）；
 * - otp 签发/校验（validateIdentity 新用户/存量/注册关闭三态 + verifyCode 缓存通道 +
 *   authWithOtp 签发与验证码消费）；
 * - oauth（gitee 全链 + github 冒烟）identity 建立链（自管 PG runner 事务内的
 *   user + email identity + oauth 绑定 upsert + email 占用拒绝 + 注册关闭拒绝）；
 * - signout 三触发（user-logout / user-kick-other / security-policy）的 RT revoke
 *   与 revoke_reason 落库（after-commit 缓存清理钩子经 ALS 钩子通道执行）；
 * - MFA verify 双通道（totp / webauthn 各一条 sys_user_mfa 行）：verified 判据、
 *   user.mfa_setup 写腿、trusted 写腿与 refresh 轮换同 em（B7c 收口后的事务形态）；
 * - sensitive：可用方式列举 / email OTP 通道 grant + Redis 授权生命周期 /
 *   不可用方式与错码拒绝 / password 通道钉现状（上游 select:false 缺陷原样保留，
 *   见 phase3-plan §6 B7c 登记）；
 * - risk：user / device / ip / failedLogin 四条评估与记录写腿（Redis 域 + PG 读腿，
 *   murlock 分布式锁用法不动）。
 *
 * controller 层取舍：auth 端点挂 sign guard（HMAC 握手）+ passport strategy guard +
 * functional guard 三层，集成装配下复刻握手成本远超 service 编排本身的被验面；
 * 与 B7a/B7b 既有 int-spec 同口径取 service 级（装配仍走完整 AppModule DI），
 * 事务拦截器形态由 pg.transaction.int-spec 覆盖。
 *
 * 注意：OPAQUE 的 serverLoginState / sessionKey 与 OTP 验证码走 CACHE_MANAGER
 * （集成装配换内存实现，设置快照仅还原内存缓存）；risk / ip / failedLogin / murlock
 * 走真实 Redis（AppTechRedisService），键带本轮 uuid 前缀并在 afterAll 清理。
 */

/** 复刻 tx.interceptor 的 ALS 钩子通道：signout / mfa.post 走 registerAfterCommitHook（strict 版） */
async function runInHookStore<T>(fn: () => Promise<T>): Promise<T> {
  const hooks: (() => Promise<void>)[] = []
  const result = await DBTransactionHooksStore.run(hooks, async () => fn())
  for (const hook of hooks) {
    await hook()
  }
  return result
}

describe('B7c auth login chain (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let configService: ConfigService

  let opaqueCore: AuthOpaqueCoreService
  let opaqueUser: AuthOpaqueUserService
  let otpService: OtpService
  let otpShared: OtpSharedService
  let verifyCodeCache: AppTechCacheVerifyCodeService
  let giteeService: OAuthGiteeService
  let githubService: OAuthGitHubService
  let authShared: AuthSharedService
  let refreshShared: AuthRefreshSharedService
  let signoutService: AuthSignoutService
  let tokenService: AppTokenService
  let mfaService: AuthMfaService
  let mfaCache: AppTechCacheMfaService
  let sensitiveService: SecuritySensitiveService
  let riskUserService: SecurityRiskUserService
  let riskDeviceService: SecurityRiskDeviceService
  let riskIPService: SecurityRiskIPService
  let riskFailedLoginService: SecurityRiskFailedLoginService
  let userRepo: SysUserRepositoryService
  let userShared: SysUserSharedService
  let identityRepo: SysUserIdentityRepositoryService
  let identityShared: SysUserIdentitySharedService
  let oauthRepo: SysUserOAuthRepositoryService
  let cacheAppSettings: AppTechCacheAppSettingsService
  let sharedIpService: SharedIpService
  let redisService: AppTechRedisService

  const seed = randomUUID()
  const unique = (prefix: string) => `${prefix}-${seed.slice(0, 8)}`

  /** 本轮创建的 user id（含 userName 随机生成的自动注册行），afterAll 按 id 清场 */
  const createdUserIds: string[] = []
  /** 本轮落到真实 Redis 的键（risk / ip 黑名单 / failed-login），afterAll 统一清 */
  const redisKeysToClean: string[] = []

  async function countPg(table: string, where: string, params: unknown[]) {
    const rows: Array<{ c: number }> = await pgDataSource.query(
      `SELECT count(*)::int AS c FROM ${table} WHERE ${where}`,
      params,
    )
    return rows[0].c
  }

  async function seedUser(userName?: string): Promise<string> {
    const rows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [userName ?? null],
    )
    createdUserIds.push(rows[0].id)
    return rows[0].id
  }

  async function seedDevice(deviceId: string) {
    await pgDataSource.query(
      'INSERT INTO sys_device (device_name, device_id, device_info, ip_history) VALUES ($1, $2, $3::jsonb, ARRAY[]::text[])',
      [`${deviceId}-name`, deviceId, '{}'],
    )
  }

  async function seedUserRole(userId: string) {
    const roleRows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_role (role_name) VALUES ($1) RETURNING id',
      [`${unique('b7c-role')}-${userId.slice(0, 8)}`],
    )
    await pgDataSource.query(
      'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2)',
      [userId, roleRows[0].id],
    )
    return roleRows[0].id
  }

  async function readIdentity(userId: string, type: string, purpose: string) {
    const rows: Array<{ id: string, value_hash: string, masked_value: string, verified: boolean, status: boolean }>
      = await pgDataSource.query(
        'SELECT id, value_hash, masked_value, verified, status FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
        [userId, type, purpose],
      )
    return rows[0]
  }

  async function readUserDevice(userId: string, deviceId: string) {
    const rows: Array<{ trusted: boolean, locked: boolean }> = await pgDataSource.query(
      'SELECT trusted, locked FROM sys_user_device WHERE user_id = $1 AND device_id = $2',
      [userId, deviceId],
    )
    return rows[0]
  }

  async function readRefreshRow(jti: string) {
    const rows: Array<{ user_id: string, device_id: string, revoked: boolean, revoke_reason: string | null }>
      = await pgDataSource.query(
        'SELECT user_id, device_id, revoked, revoke_reason FROM auth_refresh_token WHERE jti = $1',
        [jti],
      )
    return rows[0]
  }

  /** OPAQUE 客户端侧注册流程（与服务真实用法同构：identifiers 双端一致） */
  async function clientRegister(userName: string, password: string) {
    const appName = configService.get<string>('app.name')!
    const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password })
    const registrationResponse = await opaqueCore.startRegister(userName, registrationRequest)
    const { registrationRecord } = opaque.client.finishRegistration({
      clientRegistrationState,
      registrationResponse,
      password,
      identifiers: { client: userName, server: appName },
    })
    return registrationRecord
  }

  /**
   * P1-14 fixture：新用户注册 = createForAuthUser 建 user + finishRegister 补挂 password
   * identity（register 端点本身只做补挂，不再建用户）。
   */
  async function registerOpaqueUser(userName: string, password: string) {
    const registrationRecord = await clientRegister(userName, password)
    const user = await userShared.createForAuthUser({ userName }, pgDataSource.manager)
    createdUserIds.push(user.id)
    await opaqueCore.finishRegister(user.id, registrationRecord, pgDataSource.manager)
    return user
  }

  /** OPAQUE 客户端侧登录前半段：startLogin + 服务端 startLogin → 客户端 finishLogin */
  async function clientLoginFinishRequest(userName: string, password: string, deviceId: string) {
    const appName = configService.get<string>('app.name')!
    const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password })
    const loginResponse = await opaqueCore.startLogin(userName, startLoginRequest, deviceId, pgDataSource.manager)
    const loginResult = opaque.client.finishLogin({
      clientLoginState,
      loginResponse,
      password,
      identifiers: { client: userName, server: appName },
    })
    expect(loginResult).toBeTruthy()
    return loginResult!.finishLoginRequest
  }

  let appSettingsSnapshot: Record<string, unknown> | null = null

  async function applyAuthSettings(patch: Record<string, string>) {
    const snapshot = await cacheAppSettings.getAppSettings()
    if (appSettingsSnapshot === null) {
      appSettingsSnapshot = { ...(snapshot ?? {}) }
    }
    await cacheAppSettings.setAppSettings(
      { ...((snapshot ?? {}) as Record<string, unknown>), ...patch },
      { t: WalnutAdminConstAppCacheType.BUILT_IN },
    )
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    configService = app.get(ConfigService)

    opaqueCore = app.get(AuthOpaqueCoreService)
    opaqueUser = app.get(AuthOpaqueUserService)
    otpService = app.get(OtpService)
    otpShared = app.get(OtpSharedService)
    verifyCodeCache = app.get(AppTechCacheVerifyCodeService)
    giteeService = app.get(OAuthGiteeService)
    githubService = app.get(OAuthGitHubService)
    authShared = app.get(AuthSharedService)
    refreshShared = app.get(AuthRefreshSharedService)
    signoutService = app.get(AuthSignoutService)
    tokenService = app.get(AppTokenService)
    mfaService = app.get(AuthMfaService)
    mfaCache = app.get(AppTechCacheMfaService)
    sensitiveService = app.get(SecuritySensitiveService)
    riskUserService = app.get(SecurityRiskUserService)
    riskDeviceService = app.get(SecurityRiskDeviceService)
    riskIPService = app.get(SecurityRiskIPService)
    riskFailedLoginService = app.get(SecurityRiskFailedLoginService)
    userRepo = app.get(SysUserRepositoryService)
    userShared = app.get(SysUserSharedService)
    identityRepo = app.get(SysUserIdentityRepositoryService)
    identityShared = app.get(SysUserIdentitySharedService)
    oauthRepo = app.get(SysUserOAuthRepositoryService)
    cacheAppSettings = app.get(AppTechCacheAppSettingsService)
    sharedIpService = app.get(SharedIpService)
    redisService = app.get(AppTechRedisService)

    // opaque serverSetup 必须已配置（服务构造期读 jwt.opaque.secret）
    expect(configService.get<string>('jwt.opaque.secret')).toBeTruthy()

    // defaultRole 兜底 fixture：集成库 settings 缓存为空 → createForAuthUser 走
    // cache.appSettings 的 v5 兜底 uuid（visitor role）—— PG 侧必须有该行，junction /
    // current_role_id 写入才不炸 FK（生产库由 ETL/seed 落地，B5 订正脚本同源）
    await pgDataSource.query(
      'INSERT INTO sys_role (id, role_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      ['d6e8ca57-1faf-56d7-b090-9ff0c0b78ce6', unique('b7c-visitor-role')],
    )
  })

  afterAll(async () => {
    // 1) 设置快照还原（内存 CACHE_MANAGER）
    if (appSettingsSnapshot !== null) {
      await cacheAppSettings.setAppSettings(appSettingsSnapshot, { t: WalnutAdminConstAppCacheType.BUILT_IN })
    }

    // 2) PG 侧行随 user / device CASCADE 清场（identity / oauth / mfa / refresh /
    //    user_device / sys_user_role 都挂在 user 上）
    if (createdUserIds.length > 0) {
      await pgDataSource.query('DELETE FROM sys_user WHERE id = ANY($1::uuid[])', [createdUserIds])
    }
    await pgDataSource.query('DELETE FROM sys_device WHERE device_id LIKE $1', ['b7c-%'])
    await pgDataSource.query('DELETE FROM sys_role WHERE role_name LIKE $1', [`${unique('b7c-role')}%`])
    await pgDataSource.query('DELETE FROM sys_role WHERE id = $1', ['d6e8ca57-1faf-56d7-b090-9ff0c0b78ce6'])

    // 3) 真实 Redis 键清理（risk 系列 + ip 临时黑名单 + failed-login）
    if (redisKeysToClean.length > 0) {
      await redisService.getClient().del([...new Set(redisKeysToClean)])
    }

    // 4) 本轮缓存键清理（会话 / mfa verified / opaque 状态 / 验证码 —— 键内含 deviceId /
    //    identifier 携带的 seed 片段；SCAN 精确收集后删除，绕开 cacheService.delByPattern
    //    的空 scan 页缺陷）
    const staleCacheKeys: string[] = []
    for await (const keys of redisService.getClient().scanIterator({ MATCH: `WALNUT_CACHE_*${seed.slice(0, 8)}*`, COUNT: 200 })) {
      staleCacheKeys.push(...keys)
    }
    if (staleCacheKeys.length > 0) {
      await redisService.getClient().del(staleCacheKeys)
    }

    await app.close()
  })

  describe('opaque 补挂口令/登录（真实 crypto 栈，B7 核心验收：identity 腿事务）', () => {
    const password = `pwd-${seed.slice(0, 8)}-42`

    it('finishRegister：按 userId 补挂 password identity（value 存注册记录本体，maskedValue 兜底）', async () => {
      const userName = unique('b7c-opaque-reg')
      const registrationRecord = await clientRegister(userName, password)
      const user = await userShared.createForAuthUser({ userName }, pgDataSource.manager)
      createdUserIds.push(user.id)

      await opaqueCore.finishRegister(user.id, registrationRecord, pgDataSource.manager)

      const identity = await readIdentity(user.id, 'password', 'login')
      expect(identity).toBeTruthy()
      expect(identity.value_hash).toBe(registrationRecord)
      expect(identity.masked_value).toBe('********')
      expect(identity.verified).toBe(true)
    })

    it('补挂原子性：finishRegister 的 identity 腿挂调用方 em —— 事务整体回滚则 identity 同清', async () => {
      const userName = unique('b7c-opaque-rb')
      const registrationRecord = await clientRegister(userName, password)
      const user = await userShared.createForAuthUser({ userName }, pgDataSource.manager)
      createdUserIds.push(user.id)

      await expect(pgDataSource.transaction(async (em) => {
        await opaqueCore.finishRegister(user.id, registrationRecord, em)
        // identity 腿已执行 —— 主动抛出触发整体回滚
        throw new Error('force-rollback')
      })).rejects.toThrow('force-rollback')

      // identity 腿必须被回滚清空（opaque 的 value_hash 即 registrationRecord）
      expect(await countPg('sys_user_identity', 'value_hash = $1', [registrationRecord])).toBe(0)
    })

    it('重复补挂：finishRegister 对同一 userId upsert 替换 value/valueHash（不再 DataExists）', async () => {
      const userName = unique('b7c-opaque-dup')
      const firstRecord = await clientRegister(userName, password)
      const user = await userShared.createForAuthUser({ userName }, pgDataSource.manager)
      createdUserIds.push(user.id)
      await opaqueCore.finishRegister(user.id, firstRecord, pgDataSource.manager)

      const secondRecord = await clientRegister(userName, `${password}-next`)
      await expect(opaqueCore.finishRegister(user.id, secondRecord, pgDataSource.manager)).resolves.toBe(true)

      const identity = await readIdentity(user.id, 'password', 'login')
      expect(identity.value_hash).toBe(secondRecord)
      expect(await countPg('sys_user_identity', 'user_id = $1 AND type = $2 AND purpose = $3', [user.id, 'password', 'login'])).toBe(1)
    })

    it('登录全链：startLogin → validateOpaqueUser（strategy 体）→ finishLogin 签发三件套 + refresh/device 同事务落库', async () => {
      const userName = unique('b7c-opaque-login')
      const user = await registerOpaqueUser(userName, password)

      const deviceId = unique('b7c-opaque-login-dev')
      await seedDevice(deviceId)

      const finishLoginRequest = await clientLoginFinishRequest(userName, password, deviceId)

      // strategy（guard 阶段）的 validate 体：完成 OPAQUE 校验并缓存 sessionKey
      const payload = await opaqueUser.validateOpaqueUser(userName, finishLoginRequest, deviceId)
      expect(payload.userId).toBe(user.id)
      expect(payload.userName).toBe(userName)

      // handler 阶段：finishLogin 签发（session + AT + RT + device bind，单 em）
      const { accessToken, refreshTokenJti, authSessionKey } = await opaqueCore.finishLogin(payload, deviceId, pgDataSource.manager)

      const decoded = await tokenService.decodeAccessToken(accessToken)
      expect(decoded?.userId).toBe(user.id)
      expect(decoded?.sid).toBeTruthy()

      const rtRow = await readRefreshRow(refreshTokenJti)
      expect(rtRow.user_id).toBe(user.id)
      expect(rtRow.device_id).toBe(deviceId)
      expect(rtRow.revoked).toBe(false)

      // B7c 收口：登录事务里 refresh 与设备绑定联动腿同落（同一 em）
      const deviceRow = await readUserDevice(user.id, deviceId)
      expect(deviceRow).toBeTruthy()
      expect(deviceRow.trusted).toBe(false)

      expect(Buffer.from(authSessionKey, 'base64').length).toBeGreaterThan(0)
    })

    it('错误 finishLoginRequest：validateOpaqueUser 拒绝（InvalidCredential）', async () => {
      const userName = unique('b7c-opaque-bad')
      await registerOpaqueUser(userName, password)

      const deviceId = unique('b7c-opaque-bad-dev')
      await seedDevice(deviceId)

      await clientLoginFinishRequest(userName, password, deviceId)
      const forged = Buffer.from(`forged-${seed}`).toString('base64')

      await expect(opaqueUser.validateOpaqueUser(userName, forged, deviceId))
        .rejects
        .toThrow(WalnutAdminExceptionInvalidCredential)
    })
  })

  describe('登录事务原子性：generateAuthTokens 的 refresh + device 联动腿', () => {
    let userId = ''
    let payload: IWalnutAdminAccessTokenPayload

    beforeAll(async () => {
      userId = await seedUser(unique('b7c-tokens-user'))
      await seedUserRole(userId)
      const user = await userRepo.findUserByUserId(userId, pgDataSource.manager)
      const populated = await userShared.getUserWithPopulatedRoles(user!, pgDataSource.manager)
      payload = await tokenService.getJwtAccessTokenPayload(populated, { isTrusted: false })
    })

    it('回滚：refresh 行与 user_device 行同回滚（B7c 把 bindDeviceForUser 收进事务后不再有事务外写腿）', async () => {
      const deviceId = unique('b7c-tokens-rb-dev')
      await seedDevice(deviceId)

      await expect(pgDataSource.transaction(async (em) => {
        await authShared.generateAuthTokens(payload, deviceId, em)
        throw new Error('force-rollback')
      })).rejects.toThrow('force-rollback')

      expect(await countPg('auth_refresh_token', 'user_id = $1 AND device_id = $2', [userId, deviceId])).toBe(0)
      expect(await countPg('sys_user_device', 'user_id = $1 AND device_id = $2', [userId, deviceId])).toBe(0)
    })

    it('提交：refresh 行 + user_device 行两腿同落', async () => {
      const deviceId = unique('b7c-tokens-commit-dev')
      await seedDevice(deviceId)

      const { refreshTokenJti } = await authShared.generateAuthTokens(payload, deviceId, pgDataSource.manager)

      const rtRow = await readRefreshRow(refreshTokenJti)
      expect(rtRow.revoked).toBe(false)
      expect(await countPg('sys_user_device', 'user_id = $1 AND device_id = $2', [userId, deviceId])).toBe(1)
    })
  })

  describe('otp 签发/校验 + identity 建立链', () => {
    const emailEnabled = JSON.stringify({ authEnable: 1, sendEnable: 0, verifyFigure: 6, verifyTtl: 300, sendLimit: 5, sendTtl: 600, newUserSignup: 1 })
    const emailDisabled = JSON.stringify({ authEnable: 1, sendEnable: 0, verifyFigure: 6, verifyTtl: 300, sendLimit: 5, sendTtl: 600, newUserSignup: 0 })
    const emailA = `b7c-otp-a-${seed.slice(0, 8)}@walnut.local`

    it('validateIdentity 新用户：user + email identity 两腿（自管 PG runner 事务，identity 默认未验证）', async () => {
      await applyAuthSettings({ 'app.auth.email': emailEnabled })

      const payload = await otpService.validateIdentity('email', emailA, 'zh_CN', unique('b7c-otp-dev'))
      createdUserIds.push(payload.userId)

      const identity = await readIdentity(payload.userId, 'emailAddress', 'login')
      expect(identity).toBeTruthy()
      expect(identity.value_hash).toBe(identityShared.generateValueHash(emailA))
      expect(identity.verified).toBe(false)
    })

    it('validateIdentity 存量：同 identifier → 同一 userId（不再新建）', async () => {
      const first = await otpService.validateIdentity('email', emailA, 'zh_CN', unique('b7c-otp-dev'))
      const second = await otpService.validateIdentity('email', emailA, 'zh_CN', unique('b7c-otp-dev'))
      createdUserIds.push(first.userId)
      expect(second.userId).toBe(first.userId)
      expect(await countPg('sys_user_identity', 'value_hash = $1', [identityShared.generateValueHash(emailA)])).toBe(1)
    })

    it('validateIdentity 注册关闭 → SignupBanned', async () => {
      await applyAuthSettings({ 'app.auth.email': emailDisabled })

      await expect(otpService.validateIdentity('email', `b7c-otp-b-${seed.slice(0, 8)}@walnut.local`, 'zh_CN', unique('b7c-otp-dev')))
        .rejects
        .toThrow(WalnutAdminExceptionSignupBanned)
    })

    it('verifyCode 缓存通道：对码通过 / 错码拒绝 / 无码拒绝', async () => {
      const identifier = `b7c-otp-code-${seed.slice(0, 8)}@walnut.local`
      await verifyCodeCache.setVerifyCodeForVisitorCache(identifier, 654321, 300)

      expect(await otpShared.verifyCode('email', identifier, '654321')).toBe(true)
      expect(await otpShared.verifyCode('email', identifier, '000000')).toBe(false)
      await verifyCodeCache.delVerifyCodeForVisitorCache(identifier)
      expect(await otpShared.verifyCode('email', identifier, '654321')).toBe(false)
    })

    it('authWithOtp：签发三件套 + 验证码消费（removeVerifyCode）', async () => {
      await applyAuthSettings({ 'app.auth.email': emailEnabled })

      const identifier = `b7c-otp-use-${seed.slice(0, 8)}@walnut.local`
      await verifyCodeCache.setVerifyCodeForVisitorCache(identifier, 111222, 300)

      const loginPayload = await otpService.validateIdentity('email', emailA, 'zh_CN', unique('b7c-otp-dev'))
      createdUserIds.push(loginPayload.userId)

      const deviceId = unique('b7c-otp-use-dev')
      await seedDevice(deviceId)

      const { accessToken, refreshTokenJti } = await otpService.authWithOtp('email', identifier, loginPayload, deviceId, pgDataSource.manager)

      const decoded = await tokenService.decodeAccessToken(accessToken)
      expect(decoded?.userId).toBe(loginPayload.userId)
      expect((await readRefreshRow(refreshTokenJti)).revoked).toBe(false)

      // authWithOtp 的 finally 消费验证码
      expect(await otpShared.verifyCode('email', identifier, '111222')).toBe(false)
    })
  })

  describe('oauth（gitee 全链 + github 冒烟）identity 建立链', () => {
    const giteeEnabled = JSON.stringify({ authEnable: 1, newUserSignup: 1 })
    const giteeDisabled = JSON.stringify({ authEnable: 1, newUserSignup: 0 })
    const githubEnabled = JSON.stringify({ authEnable: 1, newUserSignup: 1 })

    it('gitee 新用户：user + email identity + oauth 绑定（自管 PG runner 单事务）', async () => {
      await applyAuthSettings({ 'app.auth.gitee': giteeEnabled })

      const providerId = unique('b7c-gitee')
      const email = `b7c-gitee-${seed.slice(0, 8)}@walnut.local`
      const payload = await giteeService.validateIdentity(providerId, unique('b7c-gitee-u'), email, '', 'zh_CN', unique('b7c-gitee-dev'))
      createdUserIds.push(payload.userId)

      const binding = await oauthRepo.findByProviderAndProviderId('gitee', providerId)
      expect(binding?.userId).toBe(payload.userId)

      const identity = await readIdentity(payload.userId, 'emailAddress', 'login')
      expect(identity.value_hash).toBe(identityShared.generateValueHash(email))
    })

    it('email 已被占用：第二个 gitee 账号同 email → BadRequest（emailAlreadyBound）', async () => {
      await applyAuthSettings({ 'app.auth.gitee': giteeEnabled })

      const email = `b7c-gitee-clash-${seed.slice(0, 8)}@walnut.local`
      const first = await giteeService.validateIdentity(unique('b7c-gitee-c1'), unique('b7c-gitee-c1'), email, '', 'zh_CN', unique('b7c-gitee-dev'))
      createdUserIds.push(first.userId)

      await expect(giteeService.validateIdentity(unique('b7c-gitee-c2'), unique('b7c-gitee-c2'), email, '', 'zh_CN', unique('b7c-gitee-dev')))
        .rejects
        .toThrow(WalnutAdminExceptionBadRequest)
    })

    it('已绑定账号再登录：同一 providerId → 同一 userId（binding 命中短路）', async () => {
      await applyAuthSettings({ 'app.auth.gitee': giteeEnabled })

      const providerId = unique('b7c-gitee-again')
      const first = await giteeService.validateIdentity(providerId, unique('b7c-gitee-a'), `b7c-gitee-a-${seed.slice(0, 8)}@walnut.local`, '', 'zh_CN', unique('b7c-gitee-dev'))
      createdUserIds.push(first.userId)
      const second = await giteeService.validateIdentity(providerId, unique('b7c-gitee-a'), `b7c-gitee-a-${seed.slice(0, 8)}@walnut.local`, '', 'zh_CN', unique('b7c-gitee-dev'))
      expect(second.userId).toBe(first.userId)
    })

    it('注册关闭：未绑定的新 gitee 账号 → SignupBanned', async () => {
      await applyAuthSettings({ 'app.auth.gitee': giteeDisabled })

      await expect(giteeService.validateIdentity(unique('b7c-gitee-ban'), unique('b7c-gitee-ban'), `b7c-gitee-ban-${seed.slice(0, 8)}@walnut.local`, '', 'zh_CN', unique('b7c-gitee-dev')))
        .rejects
        .toThrow(WalnutAdminExceptionSignupBanned)
    })

    it('github 同链路冒烟：新用户 → provider=github 绑定行', async () => {
      await applyAuthSettings({ 'app.auth.github': githubEnabled })

      const providerId = unique('b7c-github')
      const payload = await githubService.validateIdentity(providerId, unique('b7c-github-u'), `b7c-github-${seed.slice(0, 8)}@walnut.local`, '', 'zh_CN', unique('b7c-github-dev'))
      createdUserIds.push(payload.userId)

      const binding = await oauthRepo.findByProviderAndProviderId('github', providerId)
      expect(binding?.userId).toBe(payload.userId)
    })
  })

  describe('signout 三触发：RT revoke 与 revoke_reason 落库', () => {
    let userId = ''

    beforeAll(async () => {
      userId = await seedUser(unique('b7c-signout-user'))
    })

    async function seedRT(deviceId: string) {
      await seedDevice(deviceId)
      return refreshShared.generateRefreshToken(userId, deviceId, `sid-${deviceId}`, pgDataSource.manager)
    }

    it('user-logout：RT 撤销落库 + after-commit 缓存清理钩子执行（钉现状：钩子内 delByPattern 空 scan 页缺陷容错）', async () => {
      const deviceId = unique('b7c-logout-dev')
      const jti = await seedRT(deviceId)

      const hooks: (() => Promise<void>)[] = []
      await DBTransactionHooksStore.run(hooks, async () => {
        await signoutService.doSignout(userId, { trigger: 'user-logout', deviceId, ip: '203.0.113.10', sid: 'sid-x' }, pgDataSource.manager)
      })
      // 缓存清理钩子里的 cacheService.delByPattern 对空 scan 页会把 undefined 塞进 del
      // （上游缺陷，登记见 phase3-plan §6 B7c）—— 共享 Redis 多页扫描时抛错，本批不修，
      // 钩子容错执行；库内 RT revoke 断言不受影响
      for (const hook of hooks) {
        await hook().catch(() => undefined)
      }

      expect((await readRefreshRow(jti)).revoked).toBe(true)
    })

    it('user-kick-other：revokeReason=userKickOther 落库（离线设备只 revoke RT）', async () => {
      const deviceId = unique('b7c-kick-dev')
      const jti = await seedRT(deviceId)

      await signoutService.doSignout(userId, { trigger: 'user-kick-other', deviceId, fingerprint: 'fp-1', isOnline: false }, pgDataSource.manager)

      const row = await readRefreshRow(jti)
      expect(row.revoked).toBe(true)
      expect(row.revoke_reason).toBe(WalnutAdminConstRevokeRTType.userKickOther)
    })

    it('admin-kick：自定义 revokeReason 落库', async () => {
      const deviceId = unique('b7c-adminkick-dev')
      const jti = await seedRT(deviceId)

      await signoutService.doSignout(userId, { trigger: 'admin-kick', deviceId, fingerprint: 'fp-2', revokeReason: WalnutAdminConstRevokeRTType.forceQuitOffline, isOnline: false }, pgDataSource.manager)

      const row = await readRefreshRow(jti)
      expect(row.revoked).toBe(true)
      expect(row.revoke_reason).toBe(WalnutAdminConstRevokeRTType.forceQuitOffline)
    })

    it('security-policy：该用户全部 RT 撤销 + reason（after-commit 通知钩子执行不抛）', async () => {
      const jti1 = await seedRT(unique('b7c-policy-dev1'))
      const jti2 = await seedRT(unique('b7c-policy-dev2'))

      await runInHookStore(async () => {
        await signoutService.doSignout(userId, { trigger: 'security-policy', revokeReason: WalnutAdminConstRevokeRTType.updatePass }, pgDataSource.manager)
      })

      expect((await readRefreshRow(jti1)).revoke_reason).toBe(WalnutAdminConstRevokeRTType.updatePass)
      expect((await readRefreshRow(jti2)).revoke_reason).toBe(WalnutAdminConstRevokeRTType.updatePass)
    })
  })

  describe('MFA verify 双通道（totp / webauthn）', () => {
    /**
     * MFA verify 链路 fixture：
     * - sys_user_mfa 行（type=totp / webauthn，device_id 松引用任意键）；
     * - verified 判据走 cacheMfaService.setVerifiedCache（getIsCurrentUserMfaVerified 读
     *   getCurrentUserMfaSetupStatus 的 enabled 计数 + methodsRequiredCount 缺省 1）；
     * - handlePostVerification 需要 (jti, device) 的有效 refresh 行（getNewAccessToken 轮换腿）。
     */
    async function seedMfaUserChannel(type: 'totp' | 'webauthn') {
      const userId = await seedUser(unique(`b7c-mfa-${type}-user`))
      await seedUserRole(userId)

      const deviceId = unique(`b7c-mfa-${type}-dev`)
      await seedDevice(deviceId)
      await pgDataSource.query(
        'INSERT INTO sys_user_device (user_id, device_id, device_name) VALUES ($1, $2, $3)',
        [userId, deviceId, 'dev'],
      )

      const credentialId = type === 'webauthn' ? unique('b7c-mfa-cred') : null
      await pgDataSource.query(
        'INSERT INTO sys_user_mfa (user_id, type, device_id, name, webauthn_credential_id) VALUES ($1, $2, $3, $4, $5)',
        [userId, type, deviceId, `${type}-mfa`, credentialId],
      )

      const jti = await refreshShared.generateRefreshToken(userId, deviceId, `sid-mfa-${type}`, pgDataSource.manager)
      await mfaCache.setVerifiedCache(userId, deviceId)

      return { userId, deviceId, jti }
    }

    it('totp 通道：verifyMfaStatus → user.mfaSetup + user_device.trusted 写腿与 refresh 轮换同 em', async () => {
      const { userId, deviceId, jti } = await seedMfaUserChannel('totp')

      // handlePostVerification 走 registerAfterCommitHook（strict）—— ALS 钩子通道内执行；
      // revoke-and-insert（2026-10-27）：返回 { accessToken, jti } —— jti 是新 RT 行
      const { accessToken: newAT, jti: newJti } = await runInHookStore(async () =>
        mfaService.verifyMfaStatus(jti, { trusted: true }, userId, 'sid-mfa-totp', deviceId, pgDataSource.manager))

      const decoded = await tokenService.decodeAccessToken(newAT)
      expect(decoded?.userId).toBe(userId)

      const user = await userRepo.findUserByUserId(userId, pgDataSource.manager)
      expect(user!.mfaSetup).toBe(true)

      // B7c 收口：trusted 写腿在 verify 事务的同一 em 上
      const deviceRow = await readUserDevice(userId, deviceId)
      expect(deviceRow.trusted).toBe(true)

      // 轮换行级形态（revoke-and-insert）：旧 jti 行撤销（reason=rotate）+ 新行未撤销
      const oldRow = await readRefreshRow(jti)
      expect(oldRow.revoked).toBe(true)
      expect(oldRow.revoke_reason).toBe(WalnutAdminConstRevokeRTType.rotate)
      expect((await readRefreshRow(newJti)).revoked).toBe(false)
    })

    it('webauthn 通道：同链路（sys_user_mfa webauthn 行 + device 维度判据）', async () => {
      const { userId, deviceId, jti } = await seedMfaUserChannel('webauthn')

      const status = await mfaService.getMfaStatus(userId, deviceId, pgDataSource.manager)
      expect(status.find(i => i.type === 'webauthn')?.enabled).toBe(true)

      const { accessToken: newAT, jti: newJti } = await runInHookStore(async () =>
        mfaService.verifyMfaStatus(jti, { trusted: true }, userId, 'sid-mfa-webauthn', deviceId, pgDataSource.manager))
      expect((await tokenService.decodeAccessToken(newAT))?.userId).toBe(userId)
      expect((await userRepo.findUserByUserId(userId, pgDataSource.manager))!.mfaSetup).toBe(true)
      expect((await readUserDevice(userId, deviceId)).trusted).toBe(true)

      // 轮换行级形态：旧 jti 撤销（rotate）+ 新行未撤销
      expect((await readRefreshRow(jti)).revoked).toBe(true)
      expect((await readRefreshRow(jti)).revoke_reason).toBe(WalnutAdminConstRevokeRTType.rotate)
      expect((await readRefreshRow(newJti)).revoked).toBe(false)
    })

    it('未验证（无 verified 缓存）→ verifyMfaStatus 拒绝（BadRequest）且不写 mfaSetup', async () => {
      const userId = await seedUser(unique('b7c-mfa-neg-user'))
      await seedUserRole(userId)
      const deviceId = unique('b7c-mfa-neg-dev')
      await seedDevice(deviceId)
      const jti = await refreshShared.generateRefreshToken(userId, deviceId, 'sid-mfa-neg', pgDataSource.manager)

      await expect(mfaService.verifyMfaStatus(jti, { trusted: false }, userId, 'sid-mfa-neg', deviceId, pgDataSource.manager))
        .rejects
        .toThrow(WalnutAdminExceptionBadRequest)

      expect((await userRepo.findUserByUserId(userId, pgDataSource.manager))!.mfaSetup).toBe(false)
    })
  })

  describe('sensitive 拦截与授权生命周期', () => {
    let userId = ''
    let password = ''
    let securityEmail = ''
    const deviceId = unique('b7c-sens-dev')

    beforeAll(async () => {
      userId = await seedUser(unique('b7c-sens-user'))
      password = `sens-pwd-${seed.slice(0, 8)}`
      securityEmail = `b7c-sens-${seed.slice(0, 8)}@walnut.local`
      await seedDevice(deviceId)

      // password identity（login purpose，真实加密链路）
      await identityShared.createIdentity(userId, 'password', 'login', password, pgDataSource.manager)
      // security email / phone identity（verified）—— getUserAvailableMethods 对缺失的
      // phone/email 读腿直接抛 DataNotFound（上游缺陷，单独用例钉现状）
      await identityShared.createIdentity(userId, 'emailAddress', 'security', securityEmail, pgDataSource.manager)
      await identityShared.verifyIdentity(userId, 'emailAddress', 'security', pgDataSource.manager)
      await identityShared.createIdentity(userId, 'phoneNumber', 'security', `138${seed.replaceAll('-', '').slice(0, 8)}`, pgDataSource.manager)
      await identityShared.verifyIdentity(userId, 'phoneNumber', 'security', pgDataSource.manager)
    })

    it('可用方式列举：password 已摘除（P1-5：opaque record 无法明文比对）+ sms/email（security verified）；mfa 未实现不列', async () => {
      const methods = await sensitiveService.getUserAvailableMethods(userId, ['password', 'sms', 'email', 'mfa'])
      expect(methods).not.toContain('password')
      expect(methods).toContain('email')
      expect(methods).toContain('sms')
      expect(methods).not.toContain('mfa')
    })

    it('缺 phone security identity 的用户 → 探测容错跳过该方式返回空集（P1-5 修复：不再 DataNotFound）', async () => {
      const bareUser = await seedUser(unique('b7c-sens-bare'))
      await identityShared.createIdentity(bareUser, 'password', 'login', 'whatever', pgDataSource.manager)

      const methods = await sensitiveService.getUserAvailableMethods(bareUser, ['password', 'sms', 'email'])
      expect(methods).toEqual([])
    })

    it('email OTP 通道：verify → grant → Redis 授权生命周期（remaining/extend/revoke）', async () => {
      await verifyCodeCache.setVerifyCodeForAuthUserCache(userId, securityEmail, 778899, 300)

      await sensitiveService.verifyAndGrantPermission(
        userId,
        deviceId,
        'basic',
        'password_change',
        'email',
        '778899',
        ['password', 'sms', 'email'],
        pgDataSource.manager,
      )

      expect(await sensitiveService.hasPermission(userId, deviceId, 'basic')).toBe(true)
      expect(await sensitiveService.getRemainingTime(userId, deviceId, 'basic')).toBeGreaterThan(0)
      expect(await sensitiveService.extendPermission(userId, deviceId, 'basic')).toBe(true)

      await sensitiveService.revokePermission(userId, deviceId, 'basic')
      expect(await sensitiveService.hasPermission(userId, deviceId, 'basic')).toBe(false)
    })

    it('不可用方式（mfa 校验未实现，availableMethods 恒不含）→ verifyMethodNotAllowed', async () => {
      await expect(sensitiveService.verifyAndGrantPermission(
        userId,
        deviceId,
        'basic',
        'password_change',
        'mfa',
        '000000',
        ['password', 'sms', 'email', 'mfa'],
        pgDataSource.manager,
      )).rejects.toThrow(WalnutAdminExceptionBadRequest)
    })

    it('email 通道错码 → verificationFailed，不授权', async () => {
      await verifyCodeCache.setVerifyCodeForAuthUserCache(userId, securityEmail, 111000, 300)

      await expect(sensitiveService.verifyAndGrantPermission(
        userId,
        deviceId,
        'basic',
        'password_change',
        'email',
        '999999',
        ['password', 'sms', 'email'],
        pgDataSource.manager,
      )).rejects.toThrow(WalnutAdminExceptionBadRequest)

      expect(await sensitiveService.hasPermission(userId, deviceId, 'basic')).toBe(false)
    })

    it('钉现状（上游缺陷原样迁移）：password 通道恒失败 —— identity value select:false 下默认查询不出列，decrypt 抛错被吞', async () => {
      // 即使提供正确明文，verifyPassword 读到的 value 为 undefined → decrypt 抛错 → catch → false
      await expect(sensitiveService.verifyAndGrantPermission(
        userId,
        deviceId,
        'basic',
        'password_change',
        'password',
        password,
        ['password', 'sms', 'email'],
        pgDataSource.manager,
      )).rejects.toThrow(WalnutAdminExceptionBadRequest)
    })
  })

  describe('risk 评估与记录写腿（Redis 域 + PG 读腿，murlock 用法不动）', () => {
    it('evaluateUser：无密码无 MFA → USER_NO_PASSWORD + USER_NO_MFA；有密码有 MFA → 零因子', async () => {
      const bareUser = await seedUser(unique('b7c-risk-bare'))
      redisKeysToClean.push(`risk:user:${bareUser}`)

      const bare = await riskUserService.evaluateUser(bareUser)
      expect(bare.factors).toContain('USER_NO_PASSWORD')
      expect(bare.factors).toContain('USER_NO_MFA')
      expect(bare.details?.noRegistration).toBe(true)

      const fullUser = await seedUser(unique('b7c-risk-full'))
      await identityRepo.createIdentity({
        userId: fullUser,
        type: 'password',
        purpose: 'login',
        value: 'enc',
        valueHash: unique('b7c-risk-hash'),
        maskedValue: 'b7c***',
        metadata: {},
      })
      await pgDataSource.query('UPDATE sys_user SET mfa_setup = true WHERE id = $1', [fullUser])
      redisKeysToClean.push(`risk:user:${fullUser}`)

      const full = await riskUserService.evaluateUser(fullUser)
      expect(full.factors).toEqual([])
      expect(full.level).toBe('LOW')
    })

    it('evaluateUser：禁用用户 → USER_DISABLED 因子', async () => {
      const disabled = await seedUser(unique('b7c-risk-disabled'))
      await pgDataSource.query('UPDATE sys_user SET status = false WHERE id = $1', [disabled])
      redisKeysToClean.push(`risk:user:${disabled}`)

      const result = await riskUserService.evaluateUser(disabled)
      expect(result.factors).toContain('USER_DISABLED')
    })

    it('evaluateDevice：新设备 DEVICE_NEW；banned 设备 DEVICE_BANNED + DEVICE_PRIVATE；未知设备零分', async () => {
      const freshId = unique('b7c-risk-fresh-dev')
      await seedDevice(freshId)
      redisKeysToClean.push(`risk:device:${freshId}`)

      const fresh = await riskDeviceService.evaluateDevice(freshId)
      expect(fresh.factors).toContain('DEVICE_NEW')
      expect(fresh.details?.isNewDevice).toBe(true)

      const bannedId = unique('b7c-risk-banned-dev')
      await pgDataSource.query(
        'INSERT INTO sys_device (device_name, device_id, device_info, ip_history, banned, private) VALUES ($1, $2, $3::jsonb, ARRAY[]::text[], true, true)',
        [`${bannedId}-name`, bannedId, '{}'],
      )
      redisKeysToClean.push(`risk:device:${bannedId}`)

      const banned = await riskDeviceService.evaluateDevice(bannedId)
      expect(banned.factors).toContain('DEVICE_BANNED')
      expect(banned.factors).toContain('DEVICE_PRIVATE')

      // 未知设备：零分 LOW
      const unknown = await riskDeviceService.evaluateDevice(unique('b7c-risk-none-dev'))
      expect(unknown.score).toBe(0)
      expect(unknown.level).toBe('LOW')
    })

    it('evaluateIP：黑名单 IP 出因子（钉现状：hGetAll 的 permanent 是字符串，\'0\' 真值 → 恒走 PERMANENT 分支，上游缺陷原样保留）；未拉黑 → 零分', async () => {
      const cleanIp = `198.51.100.${Number.parseInt(seed.slice(2, 4), 16) % 200 + 10}`
      const clean = await riskIPService.evaluateIP(cleanIp)
      expect(clean.score).toBe(0)
      expect(clean.level).toBe('LOW')

      const testIp = `203.0.113.${Number.parseInt(seed.slice(0, 2), 16) % 200 + 10}`
      redisKeysToClean.push(await sharedIpService.getTempBlackListRedisKey(testIp))

      await sharedIpService.addToTemporaryBlacklist(testIp, 'int-spec')
      const banned = await riskIPService.evaluateIP(testIp)
      // 钉现状（上游缺陷，见 phase3-plan §6 B7c 登记）：临时黑名单写的 permanent=0 经
      // Redis hGetAll 回来是字符串 '0'（真值）→ evaluateIP 恒报 IP_BLACKLIST_PERMANENT
      expect(banned.factors).toContain('IP_BLACKLIST_PERMANENT')
      expect(banned.details?.reason).toBe('int-spec')
    })

    it('failedLogin.collect：计数累计，达阈值 5 → IP 进临时黑名单（murlock 锁内写腿）', async () => {
      const identifier = unique('b7c-risk-failed')
      const deviceId = unique('b7c-risk-failed-dev')
      const ip = `192.0.2.${Number.parseInt(seed.slice(4, 6), 16) % 200 + 10}`
      redisKeysToClean.push(
        await sharedIpService.getTempBlackListRedisKey(ip),
        `risk:failed_login:${identifier}:${deviceId}`,
      )

      let count = 0
      for (let i = 0; i < 5; i++) {
        count = await riskFailedLoginService.collect({
          identifier,
          loginType: 'opaque',
          deviceId,
          ip,
          reason: 'business.auth.invalidCredential',
        })
      }
      expect(count).toBe(5)

      // 达阈值 → collect 内部把 IP 写进临时黑名单（evaluateIP 因子断言见上一用例的钉现状）
      expect(await sharedIpService.isIpBlacklisted(ip)).toBe(true)
    })
  })
})

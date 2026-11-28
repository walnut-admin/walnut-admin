import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as opaque from '@serenity-kit/opaque'
import { AppTechCacheOpaqueService, IOpaqueCacheScope } from '@walnut-server/cache'
import { WalnutAdminConstAppEnv } from '@walnut-server/const/app/env'
import { WalnutAdminExceptionInvalidCredential } from '@walnut-server/exceptions/business/auth'
import {
  SysUserIdentityRepositoryService,
  SysUserIdentitySharedService,
  SysUserRepositoryService,
} from '@walnut-server/identity'
import { isNil } from 'lodash'
import { AuthSharedService } from '../../shared/shared.service'

/**
 * F-45：不存在的用户也要走一次 identity 读腿（等时）—— 查一个恒不存在的 userId。
 * nil uuid（全 0）在 PG 里是合法 uuid 值，且 sys_user.id 是 gen_random_uuid() 生成的，
 * 永远不会与它相撞。
 */
const OPAQUE_DUMMY_USER_ID = '00000000-0000-0000-0000-000000000000'

/**
 * `startLogin` 的失败分类（2026-11-27，方案 a）。
 *
 * 只用于 **server 日志** 与**非生产环境**的 `meta.hint`；响应语义（HTTP 401 / 40103）
 * 与匿名调用者看到的通用文案零变化 —— 用户枚举红线见方法内注释。
 *
 * - `credential-format-stale`：库里 value 解不开。两类来源：① 之前的明文行；
 *   换过 `USER_ID_ENCRYPTION_KEY`。这是**当前唯一会让登录静默变砖的确定性原因**。
 * - `credential-handshake-undefined`：OPAQUE 计算没有产出 loginResponse（库返回 undefined，
 *   正常类型下不可达，防御 wasm 边界）。与 identifiers 旧口径最接近的服务端可观测形态。
 * - `credential-opaque-incompatible`：value 能解开但 OPAQUE 不认（记录损坏 / 与当前
 *   `serverSetup` 不兼容）。**注意**：identifiers 不一致主要暴露在客户端
 *   `client.finishLogin` 返回 undefined，服务端在 startLogin 阶段拿不到信号。
 * - `credential-missing`：用户存在但没有 password 身份行。
 * - `user-not-found`：用户不存在（不附提示 —— 开发环境也不把枚举面重新打开）。
 * - `client-request-invalid` / `cache-write-failed`：与凭证无关的输入 / 基建失败。
 */
const OPAQUE_LOGIN_FAILURE = {
  CREDENTIAL_FORMAT_STALE: 'credential-format-stale',
  CREDENTIAL_HANDSHAKE_UNDEFINED: 'credential-handshake-undefined',
  CREDENTIAL_OPAQUE_INCOMPATIBLE: 'credential-opaque-incompatible',
  CREDENTIAL_MISSING: 'credential-missing',
  USER_NOT_FOUND: 'user-not-found',
  CLIENT_REQUEST_INVALID: 'client-request-invalid',
  CACHE_WRITE_FAILED: 'cache-write-failed',
} as const

type OpaqueLoginFailureReason = (typeof OPAQUE_LOGIN_FAILURE)[keyof typeof OPAQUE_LOGIN_FAILURE]

/** 需要给出「修复命令」的凭证类失败（都是重跑 `db:seed:pg --admin` 能解决的） */
const SEEDABLE_CREDENTIAL_FAILURES: ReadonlySet<OpaqueLoginFailureReason> = new Set([
  OPAQUE_LOGIN_FAILURE.CREDENTIAL_FORMAT_STALE,
  OPAQUE_LOGIN_FAILURE.CREDENTIAL_HANDSHAKE_UNDEFINED,
  OPAQUE_LOGIN_FAILURE.CREDENTIAL_OPAQUE_INCOMPATIBLE,
  OPAQUE_LOGIN_FAILURE.CREDENTIAL_MISSING,
])

/**
 * OPAQUE (Oblivious Pseudorandom Function) authentication service
 * Implements password-authenticated key exchange protocol that never exposes passwords to the server
 */
@Injectable()
export class AuthOpaqueCoreService {
  /**
   * Server setup parameter for OPAQUE protocol
   * This is a long-term server secret used for all OPAQUE operations
   */
  private readonly serverSetup: string

  /**
   * Application name used for OPAQUE identifier
   * This helps distinguish between different applications using OPAQUE
   */
  private readonly appName: string

  private readonly logger = new Logger(AuthOpaqueCoreService.name)

  getAppName() {
    return this.appName
  }

  getServerSetup() {
    return this.serverSetup
  }

  /**
   * OPAQUE `server.startLogin` 的可替换接缝（2026-11）。
   *
   * 为什么需要它：`@serenity-kit/opaque` 的 `server` 对象是 `Object.freeze` 的，
   * `vi.spyOn(opaque.server, 'startLogin')` 报 `Cannot redefine property`；而
   * vitest `isolate: false` 下 `vi.mock` 是 **worker 级**的 —— 换整个包的 mock 会泄漏给
   * 后续文件（真实密码学用例拿到假实现），或在包已被真实求值后静默失效。
   * 单测用子类覆盖本方法注入固定返回值；生产路径恒为真实协议实现。
   */
  protected opaqueServerStartLogin(
    args: Parameters<typeof opaque.server.startLogin>[0],
  ): ReturnType<typeof opaque.server.startLogin> {
    return opaque.server.startLogin(args)
  }

  constructor(
    private readonly opaqueCacheService: AppTechCacheOpaqueService,

    private readonly configService: ConfigService,
    private readonly authSharedService: AuthSharedService,
    private readonly userRepo: SysUserRepositoryService,
    private readonly userIdentityRepo: SysUserIdentityRepositoryService,
    private readonly userIdentitySharedService: SysUserIdentitySharedService,
  ) {
    // Initialize server setup with a fixed value
    // this.serverSetup = opaque.server.createSetup()
    this.serverSetup = this.configService.get('jwt.opaque.secret') as string

    // Initialize application name with a fixed value
    this.appName = this.configService.get('app.name') as string
  }

  /**
   * Start the OPAQUE login flow (Step 1 of 2)
   * Receives client's login request and generates server's login response
   *
   * B7a 签名适配：user/identity 读腿迁 PG —— 事务句柄改收 `em`（ctx.em）。
   *
   * F-45（2026-11，安全纵深）：用户不存在 / 无口令凭据时**不再提前返回** —— 见方法内注释。
   *
   * L1（2026-11-27）`scope`：锁屏兜底验证（`/system/user/lock/verify/start`）复用本方法，
   * 但 `SERVER_STATE` 必须与登录流分命名空间（见 `AppTechCacheOpaqueService` 文件头），
   * 否则同 `(userName, deviceId)` 的两条流互相覆盖。
   */
  async startLogin(
    userName: string,
    startLoginRequest: string,
    deviceId: string,
    em: EntityManager,
    scope: IOpaqueCacheScope = 'login',
  ) {
    // Find user by username
    const user = await this.userRepo.findUserByUserName(userName, em)

    // F-45（用户枚举时序侧信道）：旧实现在 user 不存在（或无 password identity）时直接
    // throw，两条路径的**结构**是可量化的差异 ——
    //   存在：  1 次 user 查 + 1 次 identity 查 + 1 次 OPAQUE 计算 + 1 次 Redis 写
    //   不存在：1 次 user 查 + 0 次 identity 查 + 0 次 OPAQUE 计算 + 0 次 Redis 写
    // 差的是一次昂贵计算（本机实测 ~2-3ms）加一次 Redis 往返：攻击者对同一 userName
    // 打几次取中位数就能判定账号是否存在（登录端点本就匿名可达）。
    //
    // 修法：不存在的用户**把整个流程完整走一遍**，只是所有产出都作废 ——
    // 1) identity 读腿补一次等量查询（不存在的用户查 nil uuid，恒 null）⇒ 两条路径
    //    都是 2 次 DB 读；
    // 2) registrationRecord 传 null：@serenity-kit/opaque 的 server.startLogin 接受
    //    null（类型即 `string | null | undefined`），会用由 (serverSetup, userIdentifier)
    //    派生的 fake registration record 完成等量计算并返回 loginResponse /
    //    serverLoginState —— 不需要在服务端伪造一份真 record，也没有额外启动开销；
    // 3) 照常写一次 SERVER_STATE 缓存（同键、同 30s TTL）⇒ 两条路径都是 1 次 Redis 写；
    // 4) 等量计算 + 等量写**之后**才判失败，统一抛 40103（错误码与文案不变，顺带也不
    //    泄露「用户存在但没有口令凭据」这一子状态）。
    //
    // 代价：不存在的 userName 会多占一个 30s 的 SERVER_STATE 键（与已存在用户同量级，
    // 且登录端点有限流）—— 换掉的是可被统计的枚举信道，值得。真正的身份验证仍在
    // finishLogin：那里的 session key 只可能来自一次成功的 OPAQUE 交换。
    const encryptedPasswordIdentity =
      user === null
        ? await this.userIdentityRepo.getValueByUserIdTypeAndPurpose(
            OPAQUE_DUMMY_USER_ID,
            'password',
            'login',
            em,
          )
        : await this.userIdentityRepo.getValueByUserIdTypeAndPurpose(
            user.id,
            'password',
            'login',
            em,
          )

    let passwordIdentity: string | null = null
    let loginResponse: string | undefined
    /** 已识别出的凭证类失败（在等量计算**之前**判定，但**不提前返回**） */
    let credentialFailure: OpaqueLoginFailureReason | null = null
    let credentialFailureDetail: string | undefined
    let opaqueComputed = false

    try {
      // ①（2026-11）：password 身份的 value 是 AES-GCM 密文（与 email/phone 同口径），
      // 交给 opaque 前必须解密。解密失败（本地库里 ① 之前的明文行 / 密钥不匹配）
      // 与「凭据无效」同义，统一收敛到 40103。
      //
      // 2026-11-27（方案 a）：解密失败**不再当场 throw** —— 那样会跳过下面的 OPAQUE
      // 计算与缓存写，让「凭证陈旧」与「用户不存在」在结构上可区分（F-45 的侧信道会
      // 原样回来）。这里只记下失败原因，`registrationRecord` 保持 null 走 fake 记录，
      // 等量计算 + 等量写跑完之后再判失败（见方法末尾）。
      if (isNil(encryptedPasswordIdentity)) {
        credentialFailure =
          user === null
            ? OPAQUE_LOGIN_FAILURE.USER_NOT_FOUND
            : OPAQUE_LOGIN_FAILURE.CREDENTIAL_MISSING
      } else {
        try {
          passwordIdentity = this.userIdentitySharedService.decryptValue(encryptedPasswordIdentity)
        } catch (error) {
          credentialFailure = OPAQUE_LOGIN_FAILURE.CREDENTIAL_FORMAT_STALE
          credentialFailureDetail = error instanceof Error ? error.message : String(error)
        }
      }

      // Server creates login response using stored registration record（null ⇒ fake record）
      // 经由可替换接缝调用（见 opaqueServerStartLogin 的注释）
      const { loginResponse: computedLoginResponse, serverLoginState } =
        this.opaqueServerStartLogin({
          userIdentifier: userName,
          registrationRecord: passwordIdentity,
          serverSetup: this.getServerSetup(),
          startLoginRequest,
          identifiers: {
            client: user?.userName ?? userName,
            server: this.getAppName(),
          },
        })

      opaqueComputed = true
      loginResponse = computedLoginResponse

      // Cache server login state temporarily (30 seconds TTL)
      // This state is needed to complete the login in the next step
      // （F-45：假计算路径同样写这一条，保持 Redis 写次数一致）
      await this.opaqueCacheService.setOpaqueServerStateCache(
        userName,
        deviceId,
        serverLoginState,
        scope,
      )
    } catch (error: any) {
      // OPAQUE 计算 / 缓存写本身失败。分类只影响日志与（非生产）提示，响应仍是 40103。
      const reason: OpaqueLoginFailureReason = opaqueComputed
        ? OPAQUE_LOGIN_FAILURE.CACHE_WRITE_FAILED
        : passwordIdentity === null
          ? OPAQUE_LOGIN_FAILURE.CLIENT_REQUEST_INVALID
          : OPAQUE_LOGIN_FAILURE.CREDENTIAL_OPAQUE_INCOMPATIBLE
      const detail = error instanceof Error ? error.message : String(error)

      if (reason === OPAQUE_LOGIN_FAILURE.CREDENTIAL_OPAQUE_INCOMPATIBLE) {
        this.warnCredentialProblem(userName, reason, detail)
      } else {
        this.logger.error(
          `OPAQUE login start failed, userName: ${userName}, reason: ${reason}, error: ${detail}`,
        )
      }

      throw new WalnutAdminExceptionInvalidCredential(
        this.buildCredentialHintPayload(userName, reason),
      )
    }

    // 失败判定必须留在等量计算与等量写之后（提前到这里侧信道就回来了）
    if (user === null) {
      // 拼错用户名不值得刷 warn，也**不附 hint**：开发环境同样不把「账号是否存在」
      // 变成可行动信息（枚举红线）。
      throw new WalnutAdminExceptionInvalidCredential()
    }

    // OPAQUE 没产出 loginResponse（类型上不可达，防御 wasm 边界）—— 与「握手 undefined」
    // （identifiers 旧口径在客户端的表现）归为一类。
    if (typeof loginResponse !== 'string' || loginResponse.length === 0) {
      const reason = credentialFailure ?? OPAQUE_LOGIN_FAILURE.CREDENTIAL_HANDSHAKE_UNDEFINED
      this.warnCredentialProblem(userName, reason, credentialFailureDetail)
      throw new WalnutAdminExceptionInvalidCredential(
        this.buildCredentialHintPayload(userName, reason),
      )
    }

    if (credentialFailure !== null || isNil(passwordIdentity)) {
      const reason = credentialFailure ?? OPAQUE_LOGIN_FAILURE.CREDENTIAL_MISSING
      this.warnCredentialProblem(userName, reason, credentialFailureDetail)
      throw new WalnutAdminExceptionInvalidCredential(
        this.buildCredentialHintPayload(userName, reason),
      )
    }

    // Return login response to be sent back to client
    return loginResponse
  }

  /**
   * 凭证类失败的 warn 日志（方案 a：**可行动**但只落在服务端日志里）。
   *
   * 不含口令 / 密文 / 明文记录 —— 只有 userName、原因分类与修复命令。
   */
  private warnCredentialProblem(
    userName: string,
    reason: OpaqueLoginFailureReason,
    detail?: string,
  ): void {
    const fix = `pnpm walnut db:seed:pg --admin ${userName} --password <新口令>`
    const detailPart = detail === undefined || detail === '' ? '' : `, detail: ${detail}`
    this.logger.warn(
      `OPAQUE login start rejected, userName: ${userName}, reason: ${reason}${detailPart}` +
        ` —— 该账号的口令凭据在本环境不可用，修复命令：${fix}`,
    )
  }

  /**
   * 非生产环境（development / stage）才附带的 `meta` 提示。生产环境返回 undefined，
   * 响应壳与改动前逐字节一致（JSON 序列化会丢掉 undefined 的 meta）。
   *
   * 判断走 ConfigService（`NODE_ENV`），不用 `libs/const` 的模块求值常量 —— 后者在
   * 单测 / 多进程装配里不可注入，而这里需要按环境分别断言。
   */
  private buildCredentialHintPayload(
    userName: string,
    reason: OpaqueLoginFailureReason,
  ): { meta: Record<string, string> } | undefined {
    const env = this.configService.get<string>('NODE_ENV')
    const isNonProduction =
      env === WalnutAdminConstAppEnv.DEV || env === WalnutAdminConstAppEnv.STAGE
    if (!isNonProduction || !SEEDABLE_CREDENTIAL_FAILURES.has(reason)) return undefined

    const fix = `pnpm walnut db:seed:pg --admin ${userName} --password <新口令>`
    const explanations: Record<typeof reason, string> = {
      [OPAQUE_LOGIN_FAILURE.CREDENTIAL_FORMAT_STALE]:
        '口令凭据格式陈旧（旧明文行或换过 USER_ID_ENCRYPTION_KEY），当前登录链无法解密',
      [OPAQUE_LOGIN_FAILURE.CREDENTIAL_HANDSHAKE_UNDEFINED]:
        '口令凭据与当前 OPAQUE 协议参数不兼容（identifiers / AUTH_OPAQUE_SECRET 口径变化）',
      [OPAQUE_LOGIN_FAILURE.CREDENTIAL_OPAQUE_INCOMPATIBLE]:
        '口令凭据记录无法被当前 OPAQUE 参数解析',
      [OPAQUE_LOGIN_FAILURE.CREDENTIAL_MISSING]: '该账号没有可用的 password 身份行',
      [OPAQUE_LOGIN_FAILURE.USER_NOT_FOUND]: '',
      [OPAQUE_LOGIN_FAILURE.CLIENT_REQUEST_INVALID]: '',
      [OPAQUE_LOGIN_FAILURE.CACHE_WRITE_FAILED]: '',
    }

    return {
      meta: {
        reason,
        hint: `${explanations[reason]}；本次登录必然 40103。修复：${fix}`,
      },
    }
  }

  /**
   * Finalize the login process and generate authentication tokens
   * This is called after successful OPAQUE validation to issue JWT tokens
   * （B7b 归一：refresh 写腿迁 PG —— 事务句柄改 em，controller 传 ctx.em）
   */
  async finishLogin(payload: IWalnutAdminAccessTokenPayload, deviceId: string, em?: EntityManager) {
    try {
      // Retrieve the session key established during OPAQUE validation
      const sessionKey = await this.opaqueCacheService.getOpaqueSessionKeyCache(
        payload.userName,
        deviceId,
      )

      if (isNil(sessionKey)) {
        throw new WalnutAdminExceptionInvalidCredential()
      }

      // Generate final authentication tokens with the OPAQUE-derived session key
      return await this.authSharedService.generateAuthTokens(payload, deviceId, em, sessionKey)
    } finally {
      // Clean up cached session key after token generation
      await this.opaqueCacheService.delOpaqueSessionKeyCache(payload.userName, deviceId)
    }
  }

  /**
   * L1（2026-11-27）：锁屏兜底验证的**验证核**（不签发 token）。
   *
   * 与 `AuthOpaqueUserService.validateOpaqueUser` 走同一套 `opaque.server.finishLogin`
   * （密码学部分零新代码），区别只有三点：
   * 1. `scope='unlock'` —— 读锁屏兜底流的 `SERVER_STATE` 命名空间；
   * 2. **不**缓存 session key、**不**生成 AT/RT、**不**建会话（规避 DuplicateSignIn，
   *    见设计稿 §4.2）；调用方拿到 `userId` 后直接走解锁执行腿；
   * 3. 返回值只有身份，供 controller 做 `verified.userId === token.userId` 断言
   *    （防止「用 A 的登录口令解 B 的锁」）。
   *
   * 失败一律 40103（与登录同码，不区分「用户不存在 / 无口令凭据 / 口令错」）。
   */
  async verifyLoginForUnlock(
    userName: string,
    finishLoginRequest: string,
    deviceId: string,
    em: EntityManager,
    scope: IOpaqueCacheScope = 'unlock',
  ): Promise<{ userId: string }> {
    // 1. Retrieve cached server login state（缺失 = start 未执行 / 已过期 / 已被消费）
    const serverLoginState = await this.opaqueCacheService.getOpaqueServerStateCache(
      userName,
      deviceId,
      scope,
    )
    if (isNil(serverLoginState)) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    // 2. 用户必须在（登录口令挂在这张用户上）
    const user = await this.userRepo.findUserByUserName(userName, em)
    if (!user) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    try {
      // 3. Server completes login verification（口令错误 / 畸形 finish 都抛）
      opaque.server.finishLogin({
        finishLoginRequest,
        serverLoginState,
        identifiers: {
          client: user.userName!,
          server: this.getAppName(),
        },
      })

      return { userId: user.id }
    } catch (error: any) {
      this.logger.error(`OPAQUE unlock verify failed, userName: ${userName}, error: ${error}`)
      throw new WalnutAdminExceptionInvalidCredential()
    } finally {
      // 4. 单次消费：成功失败都清（与登录 finish 的 finally 同口径）
      await this.opaqueCacheService.delOpaqueServerStateCache(userName, deviceId, scope)
    }
  }

  /**
   * Start user registration process（P1-14：语义 = 已登录用户补挂/替换口令）
   *
   * 不再做 userName 存在性检查 —— 登录态用户的 userName 必然存在，旧「新用户注册」
   * 查重让端点恒 40001。注册响应只依赖 userName 作为 OPAQUE identifier，不落库。
   */
  async startRegister(userName: string, registrationRequest: string) {
    try {
      const { registrationResponse } = opaque.server.createRegistrationResponse({
        userIdentifier: userName,
        registrationRequest,
        serverSetup: this.getServerSetup(),
      })

      return registrationResponse
    } catch (error) {
      this.logger.error(`OPAQUE registration start failed, userName: ${userName}`, error)
      throw new WalnutAdminExceptionInvalidCredential()
    }
  }

  /**
   * Finish user registration process（P1-14，2026-10-28）
   *
   * 按当前登录用户的 `userId` **upsert** password identity：存在即替换 value/valueHash
   * （补挂口令的同义操作），不存在则建 —— 不再按 userName 查重抛 DataExists，也不新建用户。
   * 并发补挂由 `(user_id, type, purpose)` 唯一索引 + ON CONFLICT 原子收敛。
   */
  async finishRegister(userId: string, newPassword: string, em?: EntityManager) {
    try {
      // ①（2026-11）：password 身份不再裸存 registrationRecord —— value 走 AES-GCM
      // （AAD `sys_user_identity`）、valueHash 走盐化 HMAC，与 email/phone 身份同口径；
      // 读腿在 startLogin 解密。生产未上线，不做存量迁移（本地旧明文行需重跑
      // seed / 重新补挂口令，见提交说明与计划页追记）。
      await this.userIdentityRepo.upsertIdentity(
        {
          userId,
          type: 'password',
          purpose: 'login',
          value: this.userIdentitySharedService.encryptValue(newPassword),
          valueHash: this.userIdentitySharedService.generateValueHash(newPassword),
          maskedValue: '********',
          verified: true,
          verifiedAt: new Date(),
          metadata: {},
        },
        em,
      )

      this.logger.log(`Password credential upserted for userId: ${userId}`)

      return true
    } catch (error) {
      this.logger.error(`OPAQUE registration finish failed, userId: ${userId}`, error)
      throw new WalnutAdminExceptionInvalidCredential()
    }
  }

  /**
   * Start password change process
   * Generates server's registration response for the new password
   *
   * @param userName - Username from authenticated user token
   * @param registrationRequest - Base64-encoded client registration request
   * @returns Base64-encoded server registration response
   */
  async startChangePassword(userName: string, registrationRequest: string) {
    // Find user by username
    const user = await this.userRepo.findUserByUserName(userName)
    if (!user) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    try {
      const { registrationResponse } = opaque.server.createRegistrationResponse({
        userIdentifier: userName,
        registrationRequest,
        serverSetup: this.getServerSetup(),
      })

      return registrationResponse
    } catch (error: any) {
      this.logger.error(
        `OPAQUE change password start failed, userName: ${userName}, error: ${error}`,
      )
      throw new WalnutAdminExceptionInvalidCredential()
    }
  }

  /**
   * Finish password change process（P1-14 口径：upsert，2026-11-26）
   *
   * 按 `userId` **upsert** password identity：已有口令 ⇒ 替换 value/valueHash；无口令
   * （管理端「设置初始口令」/ clear 后重置）⇒ 建行。修复前走 `updateByUserIdTypeAndPurpose`，
   * 未命中返回 null 但服务仍返回 true —— 无口令用户改密是**静默 no-op**。
   * 并发收敛与 `finishRegister` 同一条：`(user_id, type, purpose)` 唯一索引 + ON CONFLICT。
   *
   * @param userName - Username from authenticated user token
   * @param newPassword - New base64-encoded registration record from client
   *
   * B7a 签名适配：user/identity 读写腿迁 PG —— 事务句柄改收 `em`（ctx.em）。
   */
  async finishChangePassword(userName: string, newPassword: string, em: EntityManager) {
    const user = await this.userRepo.findUserByUserName(userName, em)
    if (!user) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    try {
      // Upsert password identity（①：密文 + 盐化哈希，写集与 finishRegister 逐字一致）
      await this.userIdentityRepo.upsertIdentity(
        {
          userId: user.id,
          type: 'password',
          purpose: 'login',
          value: this.userIdentitySharedService.encryptValue(newPassword),
          valueHash: this.userIdentitySharedService.generateValueHash(newPassword),
          maskedValue: '********',
          verified: true,
          verifiedAt: new Date(),
          metadata: {},
        },
        em,
      )

      this.logger.log(`Password changed successfully for user: ${userName}`)

      return true
    } catch (error: any) {
      this.logger.error(
        `OPAQUE change password finish failed, userName: ${userName}, error: ${error}`,
      )
      throw new WalnutAdminExceptionInvalidCredential()
    }
  }
}

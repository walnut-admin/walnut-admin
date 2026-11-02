import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as opaque from '@serenity-kit/opaque'
import { AppTechCacheOpaqueService } from '@walnut-server/cache'
import { WalnutAdminExceptionInvalidCredential } from '@walnut-server/exceptions/business/auth'
import { SysUserIdentityRepositoryService, SysUserRepositoryService } from '@walnut-server/identity'
import { isNil } from 'lodash'
import { AuthSharedService } from '../../shared/shared.service'

/**
 * F-45：不存在的用户也要走一次 identity 读腿（等时）—— 查一个恒不存在的 userId。
 * nil uuid（全 0）在 PG 里是合法 uuid 值，且 sys_user.id 是 gen_random_uuid() 生成的，
 * 永远不会与它相撞。
 */
const OPAQUE_DUMMY_USER_ID = '00000000-0000-0000-0000-000000000000'

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

  constructor(
    private readonly opaqueCacheService: AppTechCacheOpaqueService,

    private readonly configService: ConfigService,
    private readonly authSharedService: AuthSharedService,
    private readonly userRepo: SysUserRepositoryService,
    private readonly userIdentityRepo: SysUserIdentityRepositoryService,
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
   */
  async startLogin(userName: string, startLoginRequest: string, deviceId: string, em: EntityManager) {
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
    const passwordIdentity = user === null
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

    let loginResponse: string

    try {
      // Server creates login response using stored registration record（null ⇒ fake record）
      const { loginResponse: computedLoginResponse, serverLoginState } = opaque.server.startLogin({
        userIdentifier: userName,
        registrationRecord: passwordIdentity ?? null,
        serverSetup: this.getServerSetup(),
        startLoginRequest,
        identifiers: {
          client: user?.userName ?? userName,
          server: this.getAppName(),
        },
      })

      loginResponse = computedLoginResponse

      // Cache server login state temporarily (30 seconds TTL)
      // This state is needed to complete the login in the next step
      // （F-45：假计算路径同样写这一条，保持 Redis 写次数一致）
      await this.opaqueCacheService.setOpaqueServerStateCache(userName, deviceId, serverLoginState)
    }
    catch (error: any) {
      this.logger.error(`OPAQUE login start failed, userName: ${userName}, error: ${error}`)
      throw new WalnutAdminExceptionInvalidCredential()
    }

    // 失败判定必须留在等量计算与等量写之后（提前到这里侧信道就回来了）
    if (user === null || isNil(passwordIdentity)) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    // Return login response to be sent back to client
    return loginResponse
  }

  /**
   * Finalize the login process and generate authentication tokens
   * This is called after successful OPAQUE validation to issue JWT tokens
   * （B7b 归一：refresh 写腿迁 PG —— 事务句柄改 em，controller 传 ctx.em）
   */
  async finishLogin(payload: IWalnutAdminAccessTokenPayload, deviceId: string, em?: EntityManager) {
    try {
      // Retrieve the session key established during OPAQUE validation
      const sessionKey = await this.opaqueCacheService.getOpaqueSessionKeyCache(payload.userName, deviceId)

      if (isNil(sessionKey)) {
        throw new WalnutAdminExceptionInvalidCredential()
      }

      // Generate final authentication tokens with the OPAQUE-derived session key
      return await this.authSharedService.generateAuthTokens(
        payload,
        deviceId,
        em,
        sessionKey,
      )
    }
    finally {
      // Clean up cached session key after token generation
      await this.opaqueCacheService.delOpaqueSessionKeyCache(payload.userName, deviceId)
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
    }
    catch (error) {
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
  async finishRegister(
    userId: string,
    newPassword: string,
    em?: EntityManager,
  ) {
    try {
      await this.userIdentityRepo.upsertIdentity({
        userId,
        type: 'password',
        purpose: 'login',
        value: newPassword,
        valueHash: newPassword, // Use registration record itself as hash since it's unique
        maskedValue: '********',
        verified: true,
        verifiedAt: new Date(),
        metadata: {},
      }, em)

      this.logger.log(`Password credential upserted for userId: ${userId}`)

      return true
    }
    catch (error) {
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
    }
    catch (error: any) {
      this.logger.error(`OPAQUE change password start failed, userName: ${userName}, error: ${error}`)
      throw new WalnutAdminExceptionInvalidCredential()
    }
  }

  /**
   * Finish password change process
   * Updates user's registration record in user_identity table
   *
   * @param userName - Username from authenticated user token
   * @param newPassword - New base64-encoded registration record from client
   *
   * B7a 签名适配：user/identity 读写腿迁 PG —— 事务句柄改收 `em`（ctx.em）。
   */
  async finishChangePassword(
    userName: string,
    newPassword: string,
    em: EntityManager,
  ) {
    const user = await this.userRepo.findUserByUserName(userName, em)
    if (!user) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    try {
      // Update password identity in user_identity table
      await this.userIdentityRepo.updateByUserIdTypeAndPurpose(
        user.id,
        'password',
        'login',
        {
          value: newPassword,
          valueHash: newPassword,
        },
        em,
      )

      this.logger.log(`Password changed successfully for user: ${userName}`)

      return true
    }
    catch (error: any) {
      this.logger.error(`OPAQUE change password finish failed, userName: ${userName}, error: ${error}`)
      throw new WalnutAdminExceptionInvalidCredential()
    }
  }
}

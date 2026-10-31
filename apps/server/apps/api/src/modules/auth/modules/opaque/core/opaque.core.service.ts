import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as opaque from '@serenity-kit/opaque'
import { AppTechCacheOpaqueService } from '@walnut-server/cache'
import { WalnutAdminExceptionInvalidCredential } from '@walnut-server/exceptions/business/auth'
import { isNil } from 'lodash'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserIdentityRepositoryService } from '@/modules/system/user_identity/repo/user_identity.repo.service'
import { AuthSharedService } from '../../shared/shared.service'

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
   */
  async startLogin(userName: string, startLoginRequest: string, deviceId: string, em: EntityManager) {
    // Find user by username
    const user = await this.userRepo.findUserByUserName(userName, em)
    if (!user) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    // Get password identity from user_identity table
    const passwordIdentity = await this.userIdentityRepo.getValueByUserIdTypeAndPurpose(
      user.id,
      'password',
      'login',
      em,
    )
    if (isNil(passwordIdentity)) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    try {
      // Server creates login response using stored registration record
      const { loginResponse, serverLoginState } = opaque.server.startLogin({
        userIdentifier: userName,
        registrationRecord: passwordIdentity,
        serverSetup: this.getServerSetup(),
        startLoginRequest,
        identifiers: {
          client: user.userName!,
          server: this.getAppName(),
        },
      })

      // Cache server login state temporarily (30 seconds TTL)
      // This state is needed to complete the login in the next step
      await this.opaqueCacheService.setOpaqueServerStateCache(userName, deviceId, serverLoginState)

      // Return login response to be sent back to client
      return loginResponse
    }
    catch (error: any) {
      this.logger.error(`OPAQUE login start failed, userName: ${userName}, error: ${error}`)
      throw new WalnutAdminExceptionInvalidCredential()
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

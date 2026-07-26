import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as opaque from '@serenity-kit/opaque'
import { WalnutAdminExceptionDataExists } from '@walnut/exceptions/base/400'
import { WalnutAdminExceptionInvalidCredential } from '@walnut/exceptions/business/auth'
import { isNil } from 'lodash'
import { ClientSession } from 'mongoose'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import { SysUserIdentityRepositoryService } from '@/modules/system/user_identity/repo/user_identity.repo.service'
import { AppTechCacheOpaqueService } from '@/modules/techniques/cache/service/cache.opaque'
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

    private readonly sysUserSharedService: SysUserSharedService,
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
   */
  async startLogin(userName: string, startLoginRequest: string, deviceId: string, dbSession: ClientSession) {
    // Find user by username
    const user = await this.userRepo.findUserByUserName(userName, dbSession)
    if (!user) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    // Get password identity from user_identity table
    const passwordIdentity = await this.userIdentityRepo.getValueByUserIdTypeAndPurpose(
      user._id.toString(),
      'password',
      'login',
      dbSession,
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
          client: user.userName,
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
   */
  async finishLogin(payload: IWalnutAdminAccessTokenPayload, deviceId: string, dbSession: ClientSession) {
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
        dbSession,
        sessionKey,
      )
    }
    finally {
      // Clean up cached session key after token generation
      await this.opaqueCacheService.delOpaqueSessionKeyCache(payload.userName, deviceId)
    }
  }

  /**
   * Start user registration process
   */
  async startRegister(userName: string, registrationRequest: string) {
    // 检查用户名是否已存�?
    const existingUser = await this.userRepo.findUserByUserName(userName)
    if (existingUser) {
      throw new WalnutAdminExceptionDataExists()
    }

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
   * Finish user registration process
   */
  async finishRegister(
    userName: string,
    newPassword: string,
  ) {
    // 再次检查（防止并发�?
    const existingUser = await this.userRepo.findUserByUserName(userName)
    if (existingUser) {
      throw new WalnutAdminExceptionDataExists()
    }

    try {
      // 创建新用户（不设�?password
      const newUser = await this.sysUserSharedService.createForAuthUser({
        userName,
      })

      // �?user_identity 表中创建密码凭证
      await this.userIdentityRepo.createIdentity({
        userId: newUser._id.toString(),
        type: 'password',
        purpose: 'login',
        value: newPassword,
        valueHash: newPassword, // Use registration record itself as hash since it's unique
        maskedValue: '********',
        verified: true,
        verifiedAt: new Date(),
        metadata: {},
      })

      this.logger.log(`User registered successfully: ${userName}`)

      return true
    }
    catch (error) {
      this.logger.error(`OPAQUE registration finish failed, userName: ${userName}`, error)
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
   */
  async finishChangePassword(
    userName: string,
    newPassword: string,
    dbSession: ClientSession,
  ) {
    const user = await this.userRepo.findUserByUserName(userName, dbSession)
    if (!user) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    try {
      // Update password identity in user_identity table
      await this.userIdentityRepo.updateByUserIdTypeAndPurpose(
        user._id.toString(),
        'password',
        'login',
        {
          value: newPassword,
          valueHash: newPassword,
        },
        dbSession,
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

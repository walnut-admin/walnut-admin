import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstAppLanguage } from '@walnut-server/const/app/lang'
import { WalnutDBInjectConnection } from '@walnut-server/db'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionSignupBanned } from '@walnut-server/exceptions/business/auth'
import { ClientSession, Connection } from 'mongoose'
import { SharedWelcomeService } from '@/modules/shared/welcome/welcome.service'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import { SysUserIdentityRepositoryService } from '@/modules/system/user_identity/repo/user_identity.repo.service'
import {
  WalnutAdminConstSysUserIdentityPurpose,
  WalnutAdminConstSysUserIdentityType,
} from '@/modules/system/user_identity/schema/user_identity.schema'
import { SysUserIdentitySharedService } from '@/modules/system/user_identity/shared/user_identity.shared.service'
import { SysUserOAuthRepositoryService } from '@/modules/system/user_oauth/repo/user_oauth.repo.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

@Injectable()
export class OAuthGiteeService {
  private readonly logger = new Logger(OAuthGiteeService.name)

  @WalnutDBInjectConnection()
  readonly dbConnection: Connection

  constructor(
    private readonly sysUserSharedService: SysUserSharedService,
    private readonly sysUserRepoService: SysUserRepositoryService,
    private readonly userIdentityRepoService: SysUserIdentityRepositoryService,
    private readonly userIdentitySharedService: SysUserIdentitySharedService,
    private readonly sysUserOAuthRepoService: SysUserOAuthRepositoryService,
    private readonly welcomeService: SharedWelcomeService,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
  ) { }

  /**
   * @description Validate user identity from gitee
   * - First check if gitee account is already bound (by provider + providerId)
   * - If bound, return the associated user directly
   * - If not bound, check email identity
   * - If email identity exists, reject with email already used error
   * - If no email identity and auto-signup enabled, create new user and bind
   */
  async validateIdentity(
    giteeUserId: string,
    userName: string,
    email: string,
    avatar: string,
    language: IWalnutAdminConstAppLanguage,
    deviceId: string,
  ): Promise<IWalnutAdminAccessTokenPayload> {
    // Start transaction
    const dbSession = await this.dbConnection.startSession()
    dbSession.startTransaction()

    try {
      let result: IWalnutAdminAccessTokenPayload

      // Step 1: Check if this gitee account is already bound
      const existingBinding = await this.sysUserOAuthRepoService.findByProviderAndProviderId(
        'gitee',
        giteeUserId,
        dbSession,
      )

      if (existingBinding) {
        this.logger.log(`Gitee user ${giteeUserId} login with existing binding`)

        // Gitee account already bound, return the associated user
        const user = await this.sysUserRepoService.findUserByUserId(
          existingBinding.userId.toString(),
          dbSession,
        )
        if (!user) {
          this.logger.error(`OAuth binding exists but user not found: ${existingBinding.userId.toString()}`)
          throw new WalnutAdminExceptionSignupBanned()
        }
        result = await this.sysUserSharedService.getAccessTokenPayloadWhenUserExisted(user, deviceId)
      }
      else {
        // Step 2: Not bound - check if new user signup is allowed early
        const giteeConfig = await this.cacheAppSettingsService.getAuthOAuthGiteeConfig()

        if (giteeConfig.newUserSignup === 0) {
          throw new WalnutAdminExceptionSignupBanned()
        }

        // Step 3: Check email
        const emailHash = this.userIdentitySharedService.generateValueHash(email)

        const emailIdentity = await this.userIdentityRepoService.findByValueHash(
          WalnutAdminConstSysUserIdentityType.EMAIL_ADDRESS,
          WalnutAdminConstSysUserIdentityPurpose.LOGIN,
          emailHash,
          dbSession,
        )

        if (emailIdentity) {
          // Email identity exists - this email is already used by another user
          // Reject with specific error to inform frontend
          throw new WalnutAdminExceptionBadRequest({
            errMsg: 'business.auth.emailAlreadyBound',
          })
        }

        // Email identity not exists - new user signup
        result = await this.createNewUserWithOAuth(
          giteeUserId,
          userName,
          email,
          avatar,
          language,
          deviceId,
          dbSession,
        )
      }

      // Commit transaction
      await dbSession.commitTransaction()
      return result
    }
    catch (error) {
      // Abort transaction on error
      await dbSession.abortTransaction()
      throw error
    }
    finally {
      await dbSession.endSession()
    }
  }

  /**
   * @description Create new user with email identity and OAuth binding
   */
  private async createNewUserWithOAuth(
    giteeUserId: string,
    userName: string,
    email: string,
    avatar: string,
    language: IWalnutAdminConstAppLanguage,
    deviceId: string,
    dbSession: ClientSession,
  ): Promise<IWalnutAdminAccessTokenPayload> {
    this.logger.log(`Creating new user from Gitee: ${email}`)

    // Create new user
    const result = await this.sysUserSharedService.getAccessTokenPayloadAfterAutomaticSignUpForNonExistUser(
      { userName, avatar },
      deviceId,
      dbSession,
    )

    // Create email identity in user_identity table
    await this.userIdentitySharedService.createIdentity(
      result.userId,
      WalnutAdminConstSysUserIdentityType.EMAIL_ADDRESS,
      WalnutAdminConstSysUserIdentityPurpose.LOGIN,
      email,
      dbSession,
    )

    // Bind gitee OAuth info
    await this.sysUserOAuthRepoService.bindOAuthForUser(
      result.userId,
      'gitee',
      giteeUserId,
      dbSession,
    )

    // Send welcome email
    void this.welcomeService.sendWelcomeByType('email', email, language)

    return result
  }
}

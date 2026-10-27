import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import { WalnutAdminExceptionSignupBanned } from '@walnut-server/exceptions/business/auth'
import { LocaleType } from '@walnut/contract'
import { DataSource } from 'typeorm'
import { SharedWelcomeService } from '@/modules/shared/welcome/welcome.service'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import {
  WalnutAdminConstSysUserIdentityPurpose,
  WalnutAdminConstSysUserIdentityType,
} from '@/modules/system/user_identity/identity.const'
import { SysUserIdentityRepositoryService } from '@/modules/system/user_identity/repo/user_identity.repo.service'
import { SysUserIdentitySharedService } from '@/modules/system/user_identity/shared/user_identity.shared.service'
import { SysUserOAuthRepositoryService } from '@/modules/system/user_oauth/repo/user_oauth.repo.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

@Injectable()
export class OAuthGitHubService {
  private readonly logger = new Logger(OAuthGitHubService.name)

  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly pgDataSource: DataSource,
    private readonly sysUserSharedService: SysUserSharedService,
    private readonly sysUserRepoService: SysUserRepositoryService,
    private readonly userIdentityRepoService: SysUserIdentityRepositoryService,
    private readonly userIdentitySharedService: SysUserIdentitySharedService,
    private readonly sysUserOAuthRepoService: SysUserOAuthRepositoryService,
    private readonly welcomeService: SharedWelcomeService,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
  ) { }

  /**
   * @description Validate user identity from github
   * - First check if github account is already bound (by provider + providerId)
   * - If bound, return the associated user directly
   * - If not bound, check email identity
   * - If email identity exists, reject with email already used error
   * - If no email identity and auto-signup enabled, create new user and bind
   *
   * B7a 签名适配：user/identity/oauth 三条数据腿全部迁 PG。本流程从 passport
   * strategy（guard 阶段）发起，早于拦截器事务 —— `request.txContext` 尚不存在，
   * 故沿用 Mongo 版「自管事务」的形态换成 PG QueryRunner（签名不变，strategy 零改动）；
   * refresh 写腿在 controller 的 generateAuthTokens（ctx.em，B7b 起 PG）。
   */
  async validateIdentity(
    githubUserId: string,
    userName: string,
    email: string,
    avatar: string,
    language: LocaleType,
    deviceId: string,
  ): Promise<IWalnutAdminAccessTokenPayload> {
    // Start transaction（自管 PG 事务，guard 阶段拿不到拦截器的 txContext）
    const queryRunner = this.pgDataSource.createQueryRunner()
    await queryRunner.connect()
    await queryRunner.startTransaction()

    try {
      let result: IWalnutAdminAccessTokenPayload

      // Step 1: Check if this github account is already bound
      const existingBinding = await this.sysUserOAuthRepoService.findByProviderAndProviderId(
        'github',
        githubUserId,
        queryRunner.manager,
      )

      if (existingBinding) {
        this.logger.log(`GitHub user ${githubUserId} login with existing binding`)

        // GitHub account already bound, return the associated user
        const user = await this.sysUserRepoService.findUserByUserId(
          existingBinding.userId,
          queryRunner.manager,
        )
        if (!user) {
          this.logger.error(`OAuth binding exists but user not found: ${existingBinding.userId}`)
          throw new WalnutAdminExceptionSignupBanned()
        }
        result = await this.sysUserSharedService.getAccessTokenPayloadWhenUserExisted(user, deviceId, queryRunner.manager)
      }
      else {
        // Step 2: Not bound - check if new user signup is allowed early
        const githubConfig = await this.cacheAppSettingsService.getAuthOAuthGitHubConfig()

        if (githubConfig.newUserSignup === 0) {
          throw new WalnutAdminExceptionSignupBanned()
        }

        // Step 3: Check email
        const emailHash = this.userIdentitySharedService.generateValueHash(email)

        const emailIdentity = await this.userIdentityRepoService.findByValueHash(
          WalnutAdminConstSysUserIdentityType.EMAIL_ADDRESS,
          WalnutAdminConstSysUserIdentityPurpose.LOGIN,
          emailHash,
          queryRunner.manager,
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
          githubUserId,
          userName,
          email,
          avatar,
          language,
          deviceId,
          queryRunner.manager,
        )
      }

      // Commit transaction
      await queryRunner.commitTransaction()
      return result
    }
    catch (error) {
      // Abort transaction on error
      await queryRunner.rollbackTransaction()
      throw error
    }
    finally {
      await queryRunner.release()
    }
  }

  /**
   * @description Create new user with email identity and OAuth binding
   */
  private async createNewUserWithOAuth(
    githubUserId: string,
    userName: string,
    email: string,
    avatar: string,
    language: LocaleType,
    deviceId: string,
    em: EntityManager,
  ): Promise<IWalnutAdminAccessTokenPayload> {
    this.logger.log(`Creating new user from GitHub: ${email}`)

    // Create new user
    const result = await this.sysUserSharedService.getAccessTokenPayloadAfterAutomaticSignUpForNonExistUser(
      { userName, avatar },
      deviceId,
      em,
    )

    // Create email identity in user_identity table
    await this.userIdentitySharedService.createIdentity(
      result.userId,
      WalnutAdminConstSysUserIdentityType.EMAIL_ADDRESS,
      WalnutAdminConstSysUserIdentityPurpose.LOGIN,
      email,
      em,
    )

    // Bind github OAuth info
    await this.sysUserOAuthRepoService.bindOAuthForUser(
      result.userId,
      'github',
      githubUserId,
      em,
    )

    // Send welcome email
    void this.welcomeService.sendWelcomeByType('email', email, language)

    return result
  }
}

import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { WALNUT_DATA_SCOPE_RLS_SYSTEM_SETTINGS, WalnutPGConnectionName, withWalnutRlsTransaction } from '@walnut-server/db'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionSignupBanned } from '@walnut-server/exceptions/business/auth'
import { SysUserIdentityRepositoryService, SysUserIdentitySharedService, SysUserOAuthRepositoryService, SysUserRepositoryService, SysUserSharedService, WalnutAdminConstSysUserIdentityPurpose, WalnutAdminConstSysUserIdentityType } from '@walnut-server/identity'
import { fireAndForget } from '@walnut-server/utils/fire-and-forget'
import { LocaleType } from '@walnut/contract'
import { DataSource } from 'typeorm'
import { SharedWelcomeService } from '../../shared/welcome/welcome.service'

@Injectable()
export class OAuthGiteeService {
  private readonly logger = new Logger(OAuthGiteeService.name)

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
   * @description Validate user identity from gitee
   * - First check if gitee account is already bound (by provider + providerId)
   * - If bound, return the associated user directly
   * - If not bound, check email identity
   * - If email identity exists, reject with email already used error
   * - If no email identity and auto-signup enabled, create new user and bind
   *
   * B7a 签名适配：user/identity/oauth 三条数据腿全部迁 PG。本流程从 passport
   * strategy（guard 阶段）发起，早于拦截器事务 —— `request.txContext` 尚不存在，
   * 故沿用 Mongo 版「自管事务」的形态换成 PG QueryRunner（签名不变，strategy 零改动）；
   * refresh 写腿在 controller 的 generateAuthTokens（ctx.em，B7b 起 PG）。
   *
   * 事务生命周期交给 `withWalnutRlsTransaction`：guard 阶段没有拦截器兜底，connect /
   * startTransaction / RLS 设置（登录链无请求用户，必须显式 system）任一失败都要
   * 回滚并释放连接 —— 三步写在 try 之外的那一版会把活跃事务留在池里。
   */
  async validateIdentity(
    giteeUserId: string,
    userName: string,
    email: string,
    avatar: string,
    language: LocaleType,
    deviceId: string,
  ): Promise<IWalnutAdminAccessTokenPayload> {
    return withWalnutRlsTransaction(
      this.pgDataSource,
      WALNUT_DATA_SCOPE_RLS_SYSTEM_SETTINGS,
      async (manager) => {
        // Step 1: Check if this gitee account is already bound
        const existingBinding = await this.sysUserOAuthRepoService.findByProviderAndProviderId(
          'gitee',
          giteeUserId,
          manager,
        )

        if (existingBinding) {
          this.logger.log(`Gitee user ${giteeUserId} login with existing binding`)

          // Gitee account already bound, return the associated user
          const user = await this.sysUserRepoService.findUserByUserId(
            existingBinding.userId,
            manager,
          )
          if (!user) {
            this.logger.error(`OAuth binding exists but user not found: ${existingBinding.userId}`)
            throw new WalnutAdminExceptionSignupBanned()
          }
          return this.sysUserSharedService.getAccessTokenPayloadWhenUserExisted(user, deviceId, manager)
        }

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
          manager,
        )

        if (emailIdentity) {
          // Email identity exists - this email is already used by another user
          // Reject with specific error to inform frontend
          throw new WalnutAdminExceptionBadRequest({
            errMsg: 'business.auth.emailAlreadyBound',
          })
        }

        // Email identity not exists - new user signup
        return this.createNewUserWithOAuth(
          giteeUserId,
          userName,
          email,
          avatar,
          language,
          deviceId,
          manager,
        )
      },
      { logger: this.logger },
    )
  }

  /**
   * @description Create new user with email identity and OAuth binding
   */
  private async createNewUserWithOAuth(
    giteeUserId: string,
    userName: string,
    email: string,
    avatar: string,
    language: LocaleType,
    deviceId: string,
    em: EntityManager,
  ): Promise<IWalnutAdminAccessTokenPayload> {
    this.logger.log(`Creating new user from Gitee: ${email}`)

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

    // Bind gitee OAuth info
    await this.sysUserOAuthRepoService.bindOAuthForUser(
      result.userId,
      'gitee',
      giteeUserId,
      em,
    )

    // Send welcome email
    fireAndForget(
      this.welcomeService.sendWelcomeByType('email', email, language),
      this.logger,
      'welcome message after oauth signup (gitee)',
    )

    return result
  }
}

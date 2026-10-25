import type { LocaleType } from '@walnut/contract'
import type { ClientSession } from 'mongoose'
import type { IOtpType } from './const/otp.const'

import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionSignupBanned } from '@walnut-server/exceptions/business/auth'
import { DataSource } from 'typeorm'
import { SharedWelcomeService } from '@/modules/shared/welcome/welcome.service'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import { SysUserIdentityRepositoryService } from '@/modules/system/user_identity/repo/user_identity.repo.service'
import { SysUserIdentitySharedService } from '@/modules/system/user_identity/shared/user_identity.shared.service'
import { AuthSharedService } from '../shared/shared.service'
import { OtpIdentityTypeMap } from './const/otp.const'
import { OtpSettingService } from './otp.setting.service'
import { OtpSharedService } from './shared/otp.shared.service'

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name)

  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly pgDataSource: DataSource,
    private readonly sysUserSharedService: SysUserSharedService,
    private readonly sysUserRepoService: SysUserRepositoryService,
    private readonly userIdentityRepoService: SysUserIdentityRepositoryService,
    private readonly userIdentitySharedService: SysUserIdentitySharedService,
    private readonly welcomeService: SharedWelcomeService,
    private readonly settingService: OtpSettingService,
    private readonly authSharedService: AuthSharedService,
    private readonly otpSharedService: OtpSharedService,
  ) {}

  /**
   * Validate user identity (email or phone) with transaction
   * Creates new user if not exists and auto-signup is enabled
   *
   * B7a 签名适配：user/identity 两条数据腿全部迁 PG。本流程从 passport strategy
   * （guard 阶段）发起，早于拦截器事务 —— `request.txContext` 尚不存在，故沿用
   * Mongo 版「自管事务」的形态换成 PG QueryRunner（签名不变，strategy 零改动）；
   * refresh 写腿在 authWithOtp 的 generateAuthTokens（ctx.dbSession，7c 归一）。
   */
  async validateIdentity(
    type: IOtpType,
    identifier: string,
    language: LocaleType,
    deviceId: string,
  ): Promise<IWalnutAdminAccessTokenPayload> {
    // Start transaction（自管 PG 事务，guard 阶段拿不到拦截器的 txContext）
    const queryRunner = this.pgDataSource.createQueryRunner()
    await queryRunner.connect()
    await queryRunner.startTransaction()

    try {
      // Generate hash for lookup
      const valueHash = this.userIdentitySharedService.generateValueHash(identifier)
      const identityType = OtpIdentityTypeMap[type]

      // Check if identity exists in user_identity table
      const identity = await this.userIdentityRepoService.findByValueHash(
        identityType,
        'login',
        valueHash,
        queryRunner.manager,
      )

      let result: IWalnutAdminAccessTokenPayload

      // User existed
      if (identity) {
        const user = await this.sysUserRepoService.findUserByUserId(identity.userId, queryRunner.manager)
        if (!user) {
          this.logger.error(`${type} identity exists but user not found: ${identity.userId}`)
          throw new WalnutAdminExceptionSignupBanned()
        }
        result = await this.sysUserSharedService.getAccessTokenPayloadWhenUserExisted(user, deviceId, queryRunner.manager)
      }
      // New user
      else {
        // Check if new user auto signup is allowed
        const allowNewUserSignUp = await this.settingService.getNewUserSignup(type)

        if (!allowNewUserSignUp) {
          throw new WalnutAdminExceptionSignupBanned()
        }

        // Auto signup for new user (sensitive fields stored in user_identity, not user table)
        result = await this.sysUserSharedService.getAccessTokenPayloadAfterAutomaticSignUpForNonExistUser(
          {},
          deviceId,
          queryRunner.manager,
        )

        // Create identity in user_identity table
        await this.userIdentitySharedService.createIdentity(
          result.userId,
          identityType,
          'login',
          identifier,
          queryRunner.manager,
        )

        // Send welcome message
        void this.welcomeService.sendWelcomeByType(type, identifier, language)
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
   * Send OTP verification code
   */
  async sendVerifyCode(
    type: IOtpType,
    identifier: string,
    language: LocaleType,
  ) {
    return this.otpSharedService.sendVerifyCode(type, identifier, language)
  }

  /**
   * Authenticate with OTP and generate tokens（refresh 写腿仍在 Mongo，7c 归一）
   */
  async authWithOtp(
    type: IOtpType,
    identifier: string,
    payload: IWalnutAdminAccessTokenPayload,
    deviceId: string,
    dbSession: ClientSession,
  ) {
    try {
      return await this.authSharedService.generateAuthTokens(payload, deviceId, dbSession)
    }
    finally {
      // Remove verify code
      await this.otpSharedService.removeVerifyCode(identifier)
    }
  }
}

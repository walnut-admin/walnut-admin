import type { LocaleType } from '@walnut/contract'
import type { EntityManager } from 'typeorm'
import type { IOtpType } from './const/otp.const'

import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { applyWalnutDataScopeRlsSettings, WALNUT_DATA_SCOPE_RLS_MODE, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionSignupBanned } from '@walnut-server/exceptions/business/auth'
import { SysUserIdentityRepositoryService, SysUserIdentitySharedService, SysUserRepositoryService, SysUserSharedService } from '@walnut-server/identity'
import { DataSource } from 'typeorm'
import { SharedWelcomeService } from '@/modules/shared/welcome/welcome.service'
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
   * refresh 写腿在 authWithOtp 的 generateAuthTokens（ctx.em，B7b 起 PG）。
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
    // 数据权限三期：自管事务不在 @WalnutTx 拦截器里，必须显式 system 设置
    // （登录链无请求用户；sys_user 的 fail-closed 策略会拒绝写入）
    await applyWalnutDataScopeRlsSettings(queryRunner.manager, {
      mode: WALNUT_DATA_SCOPE_RLS_MODE.SYSTEM,
      userId: '',
      deptIds: [],
    })

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
   * Authenticate with OTP and generate tokens（B7b 签名适配：refresh 写腿迁 PG —— dbSession → em）
   */
  async authWithOtp(
    type: IOtpType,
    identifier: string,
    payload: IWalnutAdminAccessTokenPayload,
    deviceId: string,
    em?: EntityManager,
  ) {
    try {
      return await this.authSharedService.generateAuthTokens(payload, deviceId, em)
    }
    finally {
      // Remove verify code
      await this.otpSharedService.removeVerifyCode(identifier)
    }
  }
}

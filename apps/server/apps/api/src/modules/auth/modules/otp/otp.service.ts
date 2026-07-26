import type { IWalnutAdminConstAppLanguage } from '@walnut/const/app/lang'
import type { IOtpType } from './const/otp.const'

import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBInjectConnection } from '@walnut/db'
import { WalnutAdminExceptionSignupBanned } from '@walnut/exceptions/business/auth'
import { ClientSession, Connection } from 'mongoose'
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

  @WalnutDBInjectConnection()
  readonly dbConnection: Connection

  constructor(
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
   */
  async validateIdentity(
    type: IOtpType,
    identifier: string,
    language: IWalnutAdminConstAppLanguage,
    deviceId: string,
  ): Promise<IWalnutAdminAccessTokenPayload> {
    // Start transaction
    const dbSession = await this.dbConnection.startSession()
    dbSession.startTransaction()

    try {
      // Generate hash for lookup
      const valueHash = this.userIdentitySharedService.generateValueHash(identifier)
      const identityType = OtpIdentityTypeMap[type]

      // Check if identity exists in user_identity table
      const identity = await this.userIdentityRepoService.findByValueHash(
        identityType,
        'login',
        valueHash,
        dbSession,
      )

      let result: IWalnutAdminAccessTokenPayload

      // User existed
      if (identity) {
        const user = await this.sysUserRepoService.findUserByUserId(identity.userId.toString(), dbSession)
        if (!user) {
          this.logger.error(`${type} identity exists but user not found: ${identity.userId.toString()}`)
          throw new WalnutAdminExceptionSignupBanned()
        }
        result = await this.sysUserSharedService.getAccessTokenPayloadWhenUserExisted(user, deviceId)
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
          dbSession,
        )

        // Create identity in user_identity table
        await this.userIdentitySharedService.createIdentity(
          result.userId,
          identityType,
          'login',
          identifier,
          dbSession,
        )

        // Send welcome message
        void this.welcomeService.sendWelcomeByType(type, identifier, language)
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
   * Send OTP verification code
   */
  async sendVerifyCode(
    type: IOtpType,
    identifier: string,
    language: IWalnutAdminConstAppLanguage,
  ) {
    return this.otpSharedService.sendVerifyCode(type, identifier, language)
  }

  /**
   * Authenticate with OTP and generate tokens
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

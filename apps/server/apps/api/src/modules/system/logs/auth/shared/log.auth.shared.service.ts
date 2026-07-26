import { ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IWalnutAdminConstDecoratorLogAuthType, WalnutAdminConstDecoratorLogAuthType } from '@walnut/const/decorator/logAuth'
import { isNil } from 'lodash'
import { Types } from 'mongoose'
import { I18nContext } from 'nestjs-i18n'
import { WalnutAdminConstDecoratorLogAuthMetadataKey } from '@/decorators/walnut/log.auth.decorator'
import { AuthOpaqueClientErrorDTO } from '@/modules/auth/modules/opaque/dto/opaque.dto'
import { IOtpType } from '@/modules/auth/modules/otp/const/otp.const'
import { OtpVerifyDTO } from '@/modules/auth/modules/otp/dto/otp.dto'
import { SecurityRiskFailedLoginService } from '@/modules/security/risk/modules/failedLogin.service'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { SysLogAuthRepoService } from '../repo/log.auth.repo.service'

/**
 * Auth log type mapping for OTP (email/sms to log auth type)
 */
const OtpAuthLogTypeMap: Record<IOtpType, IWalnutAdminConstDecoratorLogAuthType> = {
  email: WalnutAdminConstDecoratorLogAuthType.OTP_EMAIL,
  sms: WalnutAdminConstDecoratorLogAuthType.OTP_PHONE,
}

/**
 * SysLogAuthSharedService
 *
 * Provides shared auth log functionality for cross-module use.
 * Used by decorators and guards to insert auth logs.
 */
@Injectable()
export class SysLogAuthSharedService {
  private readonly logger = new Logger(SysLogAuthSharedService.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly logAuthRepoService: SysLogAuthRepoService,
    private readonly sharedIpService: SharedIpService,
    private readonly failedLoginRiskService: SecurityRiskFailedLoginService,
  ) {}

  /**
   * Get the actual auth log type
   * Handles dynamic type resolution for OTP (maps 'otp' to 'otp_email' or 'otp_phone')
   */
  private getPayloadAuthType(
    type: IWalnutAdminConstDecoratorLogAuthType,
    request: IWalnutAdminExpressRequest,
  ): IWalnutAdminConstDecoratorLogAuthType {
    if (type === WalnutAdminConstDecoratorLogAuthType.OTP) {
      const otpType = (request.body as OtpVerifyDTO).type
      return OtpAuthLogTypeMap[otpType]
    }
    return type
  }

  /**
   * Get raw error message for auth log
   * Handles OTP and Opaque errors
   */
  private getRawErrorMessage(type: IWalnutAdminConstDecoratorLogAuthType, request: IWalnutAdminExpressRequest) {
    if (type === WalnutAdminConstDecoratorLogAuthType.OTP) {
      const clientError = (request.body as AuthOpaqueClientErrorDTO)?.clientError
      if (clientError) {
        return `business.auth.opaque.${clientError}`
      }
    }
    return 'response.40103'
  }

  /**
   * Get auth log type from metadata
   */
  getAuthLogTypeFromMetadata(context: ExecutionContext): IWalnutAdminConstDecoratorLogAuthType | undefined {
    return this.reflector.getAllAndOverride<IWalnutAdminConstDecoratorLogAuthType>(
      WalnutAdminConstDecoratorLogAuthMetadataKey,
      [context.getHandler(), context.getClass()],
    )
  }

  /**
   * Record authentication attempt
   * Insert auth log and optionally collect failed login risk
   */
  async recordAuth(
    payload: {
      request: IWalnutAdminExpressRequest
      authType: IWalnutAdminConstDecoratorLogAuthType
      identifier: string
      deviceId: string
      success: boolean
      errI18nMsg?: string
    },
  ) {
    const { request, authType, identifier, deviceId, success, errI18nMsg } = payload

    const i18n = I18nContext.current()!
    const msg = String(success
      ? i18n.t('response.20000')
      : i18n.t(errI18nMsg ?? this.getRawErrorMessage(authType, request)))

    const location = await this.sharedIpService.getLocationFromBaidu(request.realIp)

    await this.logAuthRepoService.create({
      ip: request.realIp,
      location,

      os: request.os,
      browser: request.browser,

      userId: !isNil(request.user?.userId) ? new Types.ObjectId(request.user.userId) : null,
      userName: !isNil(request.user?.userName) ? request.user.userName : null,
      identifier,

      deviceId,

      success,
      msg,

      type: this.getPayloadAuthType(authType, request),
    })

    // Collect failed login risk only for failed authentication
    if (!success) {
      await this.failedLoginRiskService.collect({
        deviceId,
        identifier,
        ip: request.realIp,
        reason: msg,
        loginType: authType,
      })
    }
  }
}

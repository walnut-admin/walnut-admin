import type { IOtpType } from '@walnut-server/identity'
import type { IWalnutAdminSystemFailedLoginRiskCollector } from '../../../system.ports'
import { ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IWalnutAdminConstDecoratorLogAuthType, WalnutAdminConstDecoratorLogAuthMetadataKey, WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import { SharedIpService } from '@walnut-server/ip'
import { isNil } from 'lodash'
import { I18nContext } from 'nestjs-i18n'
import { WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR } from '../../../system.ports'
import { SysLogAuthRepoService } from '../repo/log.auth.repo.service'

/**
 * 认证请求体里本服务用到的两个窄形状（批 7：不再 import auth 的 OTP / opaque DTO）。
 * 只做类型断言，运行期零依赖。
 */
interface IAuthLogOtpVerifyPayload {
  type: IOtpType
}

interface IAuthLogOpaqueErrorPayload {
  clientError?: string
}

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
    @Inject(WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR)
    private readonly failedLoginRiskService: IWalnutAdminSystemFailedLoginRiskCollector,
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
      const otpType = (request.body as IAuthLogOtpVerifyPayload).type
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
      const clientError = (request.body as IAuthLogOpaqueErrorPayload)?.clientError
      if (typeof clientError === 'string' && clientError !== '') {
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

      // B8（phase3-plan §4）：user_id 松引用列是 uuid，B7a 起 token 里的 userId 即
      // PG uuid —— 直传；匿名/登录失败请求为 null（Mongo 时代经
      // `new Types.ObjectId` 包装，phase2 4.15 定案松引用不再包装）
      userId: request.user?.userId ?? null,
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

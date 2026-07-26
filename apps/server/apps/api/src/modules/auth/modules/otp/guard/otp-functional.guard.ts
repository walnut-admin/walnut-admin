import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminExceptionEndPointUnavailable } from '@walnut-server/exceptions/business/app'
import { otpType } from '../const/otp.const'
import { OtpVerifyDTO } from '../dto/otp.dto'
import { OtpSettingService } from '../otp.setting.service'

/**
 * Functional Guard for OTP module
 * Dynamically checks enable/disable based on request body type (email/sms)
 */
@Injectable()
export class OtpFunctionalGuard implements CanActivate {
  private readonly logger = new Logger(OtpFunctionalGuard.name)

  constructor(private readonly settingService: OtpSettingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    const type = (request.body as OtpVerifyDTO).type

    if (!type || !Object.values(otpType).includes(type)) {
      this.logger.warn(`Invalid or missing OTP type: ${type}`)
      // Allow to pass, let validation handle the error
      return true
    }

    const isEnabled = await this.settingService.getAuthEnabled(type)

    if (!isEnabled) {
      this.logger.log(`OTP ${type} auth is disabled`)
      throw new WalnutAdminExceptionEndPointUnavailable()
    }

    return true
  }
}

/**
 * Functional Guard for OTP send endpoint
 * Checks if send is enabled for the specific type
 */
@Injectable()
export class OtpSendFunctionalGuard implements CanActivate {
  private readonly logger = new Logger(OtpSendFunctionalGuard.name)

  constructor(private readonly settingService: OtpSettingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    const type = (request.body as OtpVerifyDTO).type

    if (!type || !Object.values(otpType).includes(type)) {
      this.logger.warn(`Invalid or missing OTP type: ${type}`)
      return true
    }

    const isEnabled = await this.settingService.getSendEnabled(type)

    if (!isEnabled) {
      this.logger.log(`OTP ${type} send is disabled`)
      throw new WalnutAdminExceptionEndPointUnavailable()
    }

    return true
  }
}

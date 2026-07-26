import { Injectable, Logger } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'

import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { Strategy } from 'passport-local'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { otpType, WALNUT_ADMIN_OTP_STRATEGY } from './const/otp.const'
import { OtpVerifyDTO } from './dto/otp.dto'
import { OtpService } from './otp.service'
import { OtpSharedService } from './shared/otp.shared.service'

@Injectable()
export class OtpStrategy extends PassportStrategy(
  Strategy,
  WALNUT_ADMIN_OTP_STRATEGY,
) {
  private readonly logger = new Logger(OtpStrategy.name)

  constructor(
    private readonly otpService: OtpService,
    private readonly otpSharedService: OtpSharedService,
  ) {
    super({
      passReqToCallback: true,
      usernameField: 'identifier',
      passwordField: 'verifyCode',
    })
  }

  async validate(
    request: IWalnutAdminExpressRequest,
    identifier: string,
    verifyCode: string,
  ) {
    const type = (request.body as OtpVerifyDTO).type

    this.logger.log(`validate: ${type} - ${identifier}, ${verifyCode}`)

    if (!Object.values(otpType).includes(type)) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.invalidOtpType' })
    }

    // Set identifier to request for later use
    request.identifier = identifier

    // Verify the OTP code
    const codeOk = await this.otpSharedService.verifyCode(type, identifier, verifyCode)

    if (!codeOk) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.auth.verifyCodeError' })
    }

    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)

    return this.otpService.validateIdentity(
      type,
      identifier,
      request.language,
      deviceId,
    )
  }
}

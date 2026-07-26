import type { IOtpType } from '../const/otp.const'

import { IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldEnum } from '@walnut-server/decorators/field'
import { RealPickType } from '@walnut-server/utils/dto'
import { IdentityVerifyDTO } from '@/modules/auth/dto/identity.dto'
import { otpType } from '../const/otp.const'

/**
 * DTO for sending OTP verification code
 */
export class OtpSendDTO extends RealPickType(IdentityVerifyDTO, ['identifier'] as const) {
  @WalnutAdminDecoratorFieldEnum(() => otpType, {
    swaggerOptions: { title: 'OTP Type' },
  })
  type: IOtpType
}

/**
 * DTO for verifying OTP code and authenticating
 */
export class OtpVerifyDTO extends IntersectionType(OtpSendDTO, IdentityVerifyDTO) {}

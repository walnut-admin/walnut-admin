import { Injectable } from '@nestjs/common'
import { WalnutAdminGuardAuth } from '@/guard/auth.guard'
import { WALNUT_ADMIN_OTP_STRATEGY } from './const/otp.const'

@Injectable()
export class OtpGuard extends WalnutAdminGuardAuth(WALNUT_ADMIN_OTP_STRATEGY) {
  constructor() {
    super()
  }
}

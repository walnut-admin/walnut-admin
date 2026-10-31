import { Injectable } from '@nestjs/common'
import { WALNUT_ADMIN_OTP_STRATEGY } from '@walnut-server/auth'
import { WalnutAdminGuardAuth } from '@walnut-server/guards'

@Injectable()
export class OtpGuard extends WalnutAdminGuardAuth(WALNUT_ADMIN_OTP_STRATEGY) {
  constructor() {
    super()
  }
}

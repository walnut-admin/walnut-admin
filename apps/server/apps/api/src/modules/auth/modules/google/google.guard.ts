import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppAuthStrategy } from '@walnut/const/app/strategy'
import { WalnutAdminGuardAuth } from '@/guard/auth.guard'

@Injectable()
export class AuthGoogleGuard extends WalnutAdminGuardAuth(WalnutAdminConstAppAuthStrategy.OAUTH_GOOGLE_FED_CM) {
  constructor() {
    super()
  }
}

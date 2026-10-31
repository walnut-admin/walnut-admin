import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'
import { WalnutAdminGuardAuth } from '@walnut-server/guards'

@Injectable()
export class AuthGoogleGuard extends WalnutAdminGuardAuth(WalnutAdminConstAppAuthStrategy.OAUTH_GOOGLE_FED_CM) {
  constructor() {
    super()
  }
}

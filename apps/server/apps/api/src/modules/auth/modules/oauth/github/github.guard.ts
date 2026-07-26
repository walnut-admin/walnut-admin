import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppAuthStrategy } from '@walnut/const/app/strategy'
import { WalnutAdminGuardAuth } from '@/guard/auth.guard'

@Injectable()
export class OAuthGitHubGuard extends WalnutAdminGuardAuth(WalnutAdminConstAppAuthStrategy.OAUTH_GITHUB) {
  constructor() {
    super()
  }
}

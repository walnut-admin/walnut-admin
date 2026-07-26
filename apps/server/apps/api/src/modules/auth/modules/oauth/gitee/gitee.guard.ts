import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppAuthStrategy } from '@walnut/const/app/strategy'
import { WalnutAdminGuardAuth } from '@/guard/auth.guard'

@Injectable()
export class OAuthGiteeGuard extends WalnutAdminGuardAuth(WalnutAdminConstAppAuthStrategy.OAUTH_GITEE) {
  constructor() {
    super()
  }
}

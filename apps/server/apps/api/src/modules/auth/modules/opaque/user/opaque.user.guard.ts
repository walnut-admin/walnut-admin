import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'
import { WalnutAdminGuardAuth } from '@walnut-server/guards'

@Injectable()
export class AuthOpaqueUserGuard extends WalnutAdminGuardAuth(WalnutAdminConstAppAuthStrategy.AUTH_OPAQUE) {
  constructor() {
    super()
  }
}

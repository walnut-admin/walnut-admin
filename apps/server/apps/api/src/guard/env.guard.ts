import { applyDecorators, CanActivate, Injectable, Logger, UseGuards } from '@nestjs/common'
import { isDev } from '@walnut-server/config/utils/env'

@Injectable()
class WalnutAdminGuardDevOnly implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardDevOnly.name)

  canActivate(): boolean {
    if (!isDev) {
      this.logger.warn('Request from non-dev environment, denied')
      return false
    }
    return true
  }
}

export function WalnutAdminDecoratorDevOnly() {
  return applyDecorators(
    UseGuards(WalnutAdminGuardDevOnly),
  )
}

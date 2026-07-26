import { CanActivate, ExecutionContext, Injectable, Logger, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminExceptionIPNotAcceptable } from '@walnut/exceptions/base/406'
import { SharedIpService } from '@/modules/shared/ip/ip.service'

const WalnutAdminConstDecoratorIpFreeKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_IP_FREE')

export function WalnutAdminGuardIpFree() {
  return SetMetadata(WalnutAdminConstDecoratorIpFreeKey, true)
}

@Injectable()
export class WalnutAdminGuardIP implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardIP.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly sharedIpService: SharedIpService,
  ) { }

  async canActivate(context: ExecutionContext) {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    const ipFree = this.reflector.getAllAndOverride<boolean>(
      WalnutAdminConstDecoratorIpFreeKey,
      [context.getHandler(), context.getClass()],
    )

    if (ipFree) {
      this.logger.debug('Skipping IP for endpoint')
      return true
    }

    const isInBlackList = await this.sharedIpService.isIpBlacklisted(request.realIp)

    if (isInBlackList) {
      throw new WalnutAdminExceptionIPNotAcceptable()
    }

    return true
  }
}

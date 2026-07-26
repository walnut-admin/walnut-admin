import { Injectable, Logger, SetMetadata, Type } from '@nestjs/common'
import { ModuleRef, Reflector } from '@nestjs/core'
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler'
import { isNil } from 'lodash'

// Note: IWalnutAdminThrottleConfigProvider interface has been moved to @walnut-server/types/walnut-admin/guard.d.ts
// as IWalnutAdminThrottleConfigProvider

const THROTTLE_SERVICE_KEY = Symbol('THROTTLE_SERVICE')

export function WalnutAdminDecoratorThrottle(service: Type<IWalnutAdminThrottleConfigProvider>) {
  return SetMetadata(THROTTLE_SERVICE_KEY, service)
}

@Injectable()
export class WalnutAdminGuardThrottler extends ThrottlerGuard {
  private readonly logger = new Logger(WalnutAdminGuardThrottler.name)

  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {
    super(options, storageService, reflector)
  }

  protected async getTracker(req: IWalnutAdminExpressRequest): Promise<string> {
    return req.realIp
  }

  async handleRequest(requestProps: ThrottlerRequest) {
    const { context } = requestProps

    let { limit, ttl } = requestProps

    const TargetService = this.reflector.getAllAndOverride<Type<IWalnutAdminThrottleConfigProvider>>(
      THROTTLE_SERVICE_KEY,
      [context.getHandler(), context.getClass()],
    )

    if (!isNil(TargetService)) {
      const service = this.moduleRef.get<IWalnutAdminThrottleConfigProvider>(TargetService, {
        strict: false,
      })

      if (!isNil(service)) {
        const dynamicLimit = await service.getThrottleLimit()
        const dynamicTtl = await service.getThrottleTtl()

        if (Number.isFinite(dynamicLimit)) {
          limit = dynamicLimit
        }

        if (Number.isFinite(dynamicTtl)) {
          ttl = dynamicTtl * 1000
        }

        this.logger.debug(
          `[Throttle Override] ${TargetService.name} ?limit=${limit}, ttl=${ttl}`,
        )
      }
    }

    return super.handleRequest({
      ...requestProps,
      limit,
      ttl,
    })
  }
}

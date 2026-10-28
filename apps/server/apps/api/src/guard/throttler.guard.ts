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

    // P1-10 修复（2026-10-28）：Throttler 6.x 的 blockDuration 在 canActivate 里默认取
    // throttler.ttl（全局 10s）。动态覆盖只改 ttl 时封禁窗口仍是全局值 —— 连发攻击者
    // block 过后每 10s 又能再打 4 发。这里把 blockDuration 与动态 ttl 同步覆盖。
    let { limit, ttl, blockDuration } = requestProps

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
          blockDuration = ttl
        }

        this.logger.debug(
          `[Throttle Override] ${TargetService.name} ?limit=${limit}, ttl=${ttl}, blockDuration=${blockDuration}`,
        )
      }
    }

    return super.handleRequest({
      ...requestProps,
      limit,
      ttl,
      blockDuration,
    })
  }
}

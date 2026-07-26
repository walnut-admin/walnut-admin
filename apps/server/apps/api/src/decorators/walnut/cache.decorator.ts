import { CACHE_KEY_METADATA, CACHE_MANAGER, CACHE_TTL_METADATA, CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager'
import { applyDecorators, CallHandler, ExecutionContext, Inject, Logger, UseInterceptors } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IWalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { Cache } from 'cache-manager'
import { isNil } from 'lodash'
import { firstValueFrom, Observable, of } from 'rxjs'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'

interface IWalnutAdminDecoratorCacheConfig {
  key: IWalnutAdminConstAppCacheKeys
  // seconds
  ttl?: number
}

class WalnutAdminDecoratorCacheInterceptor extends CacheInterceptor {
  private readonly logger = new Logger(WalnutAdminDecoratorCacheInterceptor.name)

  constructor(
    @Inject(CACHE_MANAGER) readonly cacheManager: Cache,
    protected readonly reflector: Reflector,
    readonly appCacheService: AppTechCacheService,
  ) {
    super(cacheManager, reflector)
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const cacheKey = this.reflector.get<IWalnutAdminConstAppCacheKeys>(CACHE_KEY_METADATA, context.getHandler())
    const ttl = this.reflector.get<number>(CACHE_TTL_METADATA, context.getHandler())

    if (!cacheKey) {
      return next.handle()
    }

    const cachedData = await this.appCacheService.get<unknown>(cacheKey)

    if (!isNil(cachedData)) {
      this.logger.log(`Cache hit for key: ${cacheKey}`)
      return of(cachedData)
    }

    const response: unknown = await firstValueFrom(next.handle())
    await this.appCacheService.set(cacheKey, response, { t: WalnutAdminConstAppCacheType.CONTROLLER, ttl })

    return of(response)
  }
}

/**
 * @description cache decorator
 */
export function WalnutAdminDecoratorCache(config: IWalnutAdminDecoratorCacheConfig) {
  return applyDecorators(
    CacheKey(config.key),
    // default 1h cache
    CacheTTL((config.ttl ?? 3600)),
    UseInterceptors(WalnutAdminDecoratorCacheInterceptor),
  )
}

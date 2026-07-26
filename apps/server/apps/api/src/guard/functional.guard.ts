import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IWalnutAdminConstAppSettingKeys } from '@walnut/const/app/cache'
import { WalnutAdminConstDecoratorFunctionalMetadataKey } from '@walnut/const/decorator/functional'
import { WalnutAdminExceptionEndPointUnavailable } from '@walnut/exceptions/business/app'

import { Recordable } from 'easy-fns-ts'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

@Injectable()
export class WalnutAdminGuardFunctional implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardFunctional.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mainKey
      = this.reflector.getAllAndOverride<IWalnutAdminConstAppSettingKeys>(
        WalnutAdminConstDecoratorFunctionalMetadataKey.MAIN_KEY,
        [context.getHandler(), context.getClass()],
      )

    const detailKey: string = this.reflector.getAllAndOverride(
      WalnutAdminConstDecoratorFunctionalMetadataKey.DETAIL_KEY,
      [context.getHandler(), context.getClass()],
    )

    const settingCache = await this.cacheAppSettingsService.getAppSettings()

    if (settingCache === null || !Reflect.has(settingCache, mainKey)) {
      this.logger.log(`Cache missing..., key: ${mainKey}`)
      return true
    }

    // nested config with detail key
    if (detailKey) {
      const parsedMainData = JSON.parse(settingCache[mainKey as keyof typeof settingCache]) as Recordable

      if (parsedMainData[detailKey] === undefined) {
        this.logger.log(`Cache missing..., key: ${mainKey}, detailKey: ${detailKey}`)
        return true
      }

      if (+parsedMainData[detailKey] !== 1) {
        throw new WalnutAdminExceptionEndPointUnavailable()
      }
    }
    else {
      if (+settingCache[mainKey as keyof typeof settingCache] !== 1) {
        throw new WalnutAdminExceptionEndPointUnavailable()
      }
    }

    return true
  }
}

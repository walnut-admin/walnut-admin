import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { IWalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstDecoratorFunctionalMetadataKey } from '@walnut-server/const/decorator/functional'

import { WalnutAdminExceptionEndPointUnavailable } from '@walnut-server/exceptions/business/app'
import { Recordable } from 'easy-fns-ts'

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

    // P1-17：未配置态语义 —— 默认放行（历史口径）；显式 defaultClosed 的端点要求
    // settings 存在且值为 1，缺失即 50301（Google 登录暂时关闭）。
    const defaultClosed = this.reflector.getAllAndOverride<boolean>(
      WalnutAdminConstDecoratorFunctionalMetadataKey.DEFAULT_CLOSED,
      [context.getHandler(), context.getClass()],
    ) === true

    const settingCache = await this.cacheAppSettingsService.getAppSettings()

    if (settingCache === null || !Reflect.has(settingCache, mainKey)) {
      this.logger.log(`Cache missing..., key: ${mainKey}`)
      if (defaultClosed) {
        throw new WalnutAdminExceptionEndPointUnavailable()
      }
      return true
    }

    // nested config with detail key
    if (detailKey) {
      const parsedMainData = JSON.parse(settingCache[mainKey as keyof typeof settingCache]) as Recordable

      if (parsedMainData[detailKey] === undefined) {
        this.logger.log(`Cache missing..., key: ${mainKey}, detailKey: ${detailKey}`)
        if (defaultClosed) {
          throw new WalnutAdminExceptionEndPointUnavailable()
        }
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

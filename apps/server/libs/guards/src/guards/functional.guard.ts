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
      // F-24：设置值是「管理端可写」的自由文本（Redis 里的 JSON 串），坏 JSON 不能把
      // 挂本 guard 的**整域**端点打成 50000 —— 解析失败按「设置缺失」语义收口：
      // defaultClosed 端点 50301，其余放行（与上面 key 缺失分支同口径），并留 warn 现场。
      const parsedMainData = this.parseMainData(settingCache[mainKey as keyof typeof settingCache], mainKey)

      if (parsedMainData === null) {
        if (defaultClosed) {
          throw new WalnutAdminExceptionEndPointUnavailable()
        }
        return true
      }

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

  /**
   * @description 解析功能开关的嵌套配置（JSON 串）
   *
   * 返回 null = 值不可用（非字符串 / 空串 / 坏 JSON）—— 调用方按「设置缺失」语义处理。
   * 不抛错：单个坏值会连带该 guard 覆盖的所有端点不可用（F-24）。
   */
  private parseMainData(raw: unknown, mainKey: IWalnutAdminConstAppSettingKeys): Recordable | null {
    if (typeof raw !== 'string' || raw === '') {
      this.logger.warn(`Cache value is not a JSON string..., key: ${mainKey}, type: ${typeof raw}`)
      return null
    }

    try {
      const parsed = JSON.parse(raw) as unknown

      // JSON.parse 的合法产物可能是数组 / 标量：只有对象能按 detailKey 取嵌套开关
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.logger.warn(`Cache value is not a JSON object..., key: ${mainKey}`)
        return null
      }

      return parsed
    }
    catch (error) {
      this.logger.warn(
        `Cache value is broken JSON, treat as missing..., key: ${mainKey}, error: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }
}

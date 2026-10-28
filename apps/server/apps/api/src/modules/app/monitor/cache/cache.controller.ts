import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { WalnutAdminPipeCacheKey } from '@walnut-server/pipes'
import { Role } from '@walnut/contract'
import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { WalnutAdminDecoratorOperateLog } from '@/decorators/walnut/log.operate.decorator'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import {
  AppMonitorCacheDTO,
  AppMonitorCacheDTOListRequest,
  AppMonitorCacheDTOListResponse,
} from './dto/cache.dto'

const Permissions = {
  LIST: 'app:monitor:cache:list',
  READ: 'app:monitor:cache:read',
  DELETE: 'app:monitor:cache:delete',
  CLEAR: 'app:monitor:cache:clear',
} as const

const { WalnutAdminDecoratorRead, WalnutAdminDecoratorList, WalnutAdminDecoratorDelete } = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.APP_CACHE,
  DTO: AppMonitorCacheDTO,
})

@Controller('app/monitor/cache')
@ApiTags('app/monitor/cache')
@WalnutAdminDecoratorHasRole([Role.ROOT, Role.DEVELOPER], WalnutAdminConstDecoratorRoleMode.OR)
export class AppMonitorCacheController {
  constructor(
    private readonly cacheService: AppTechCacheService,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
  ) { }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead('key')
  // key 形态闸（长度上限 + 字符白名单，写入方形态见 @walnut-server/const/app/cache）：
  // 缓存键原样进 Redis 命令语义面，拦任意串（受控 40099）
  async read(@Param('key', new WalnutAdminPipeCacheKey()) key: string) {
    return {
      value: void await this.cacheService.get(key),
    }
  }

  // need to define before `WalnutAdminDecoratorDelete`
  @Delete('/clear')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.CLEAR)
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.APP_CACHE,
    action: WalnutAdminConstDecoratorLogOperateAction.CLEAR,
  })
  async clearCache() {
    await this.cacheService.clear()
    return true
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete('key')
  async deleteCache(@Param('key', new WalnutAdminPipeCacheKey()) key: string) {
    const res = void this.cacheService.del(key)

    // L3 防御性失效：这里绕过 setAppSettings 直删 Redis，若删的恰是 APP:SETTING，
    // appSettings 的进程内 memo 不会自愈 —— 无条件清一次（重建只是一次 Redis GET）
    this.cacheAppSettingsService.invalidateMemoForExternalCacheRemoval()

    return res
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: AppMonitorCacheDTOListRequest) {
    const res = await this.cacheService.list(payload)

    return new AppMonitorCacheDTOListResponse(res)
  }
}

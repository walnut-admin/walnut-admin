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
import { WalnutAdminConstRole } from '@walnut-server/const/role/index'
import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { WalnutAdminDecoratorOperateLog } from '@/decorators/walnut/log.operate.decorator'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
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
@WalnutAdminDecoratorHasRole([WalnutAdminConstRole.ROOT, WalnutAdminConstRole.DEVELOPER], WalnutAdminConstDecoratorRoleMode.OR)
export class AppMonitorCacheController {
  constructor(private readonly cacheService: AppTechCacheService) { }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead('key')
  async read(@Param('key') key: string) {
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
  async deleteCache(@Param('key') key: string) {
    return void this.cacheService.del(key)
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: AppMonitorCacheDTOListRequest) {
    const res = await this.cacheService.list(payload)

    return new AppMonitorCacheDTOListResponse(res)
  }
}

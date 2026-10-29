import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'

import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
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
  AppMonitorCacheReadResponseDTO,
} from './dto/cache.dto'

const Permissions = {
  LIST: 'app:monitor:cache:list',
  READ: 'app:monitor:cache:read',
  DELETE: 'app:monitor:cache:delete',
  CLEAR: 'app:monitor:cache:clear',
} as const

const { WalnutAdminDecoratorList, WalnutAdminDecoratorDelete } = WalnutCrudDecorators({
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

  @Get(':key')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @ApiParam({
    name: 'key',
    type: String,
    required: true,
    description: '应用缓存 key',
  })
  @ApiWalnutOkResponse({
    description: '根据 key 查询 应用缓存',
    DTO: AppMonitorCacheReadResponseDTO,
  })
  // key 形态闸（长度上限 + 字符白名单，写入方形态见 @walnut-server/const/app/cache）：
  // 缓存键原样进 Redis 命令语义面，拦任意串（受控 40099）。
  // P3-14：read 响应是 `{ value }`（非 list 行），CRUD read 装饰器会复用行 DTO，
  // 这里改为显式 Get + 专用响应 DTO（同 logger read 手法），wire 零变化。
  async read(@Param('key', new WalnutAdminPipeCacheKey()) key: string) {
    // P2-4：旧实现 `{ value: void await get(key) }` 把 await 的结果 void 掉 → 恒 undefined，
    // 响应体永远是 `{}`。补 await 后 value 即缓存真实值（缺失键为 null）。
    return {
      value: await this.cacheService.get<unknown>(key),
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
    // P2-4 契约：delete 是 **fire-and-forget** —— 响应先于 Redis DEL 落盘，data 恒为空
    // （`void` 表达式值为 undefined，序列化后无 data）。客户端不得把 20000 当作「键已
    // 消失」的同步保证；需要确认删除请随后 GET read（键缺失回 value: null）。该语义由
    // monitor.api-spec 的「响应后键消失（轮询）」用例钉住。
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

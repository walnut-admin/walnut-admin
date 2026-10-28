import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { plainToInstance } from 'class-transformer'

import { WalnutCrudDecorators } from '@/decorators/crud'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorOperateLog } from '@/decorators/walnut/log.operate.decorator'
import { WalnutAdminDecoratorDeviceId } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardCapFree } from '@/guard/cap.guard'
import { WalnutAdminGuardDeviceFree } from '@/guard/device.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { WalnutAdminGuardJwtFree } from '@/modules/auth/modules/jwt/jwt-access.guard'
import {
  AppMonitorUserDTO,
  AppMonitorUserDTOListRequest,
  AppMonitorUserDTOListResponse,
  AppMonitorUserDTOReadResponse,
  AppMonitorUserDTOUpdateState,
} from './dto/user.dto'
import { AppMonitorUserService } from './user.service'

const Permissions = {
  LIST: 'app:monitor:user:list',
  READ: 'app:monitor:user:read',
  FORCE_QUIT: 'app:monitor:user:forceQuit',
} as const

const { WalnutAdminDecoratorList, WalnutAdminDecoratorRead } = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.APP_MONITOR_USER,
  DTO: AppMonitorUserDTO,
})

/**
 * B6 迁移（controller 层，B1 同款）：路由参数 ParamMongoId → uuid 参数装饰器；事务
 * 句柄 `ctx.dbSession` → `ctx.em`；`.toObject()` 移除，出参统一 plainToInstance。
 * forceQuit 的 refresh revoke 写腿仍在 Mongo（B7），同一事务里 em + dbSession 并传。
 */
@Controller('app/monitor/user')
@ApiTags('app/monitor/user')
export class AppMonitorUserController {
  private readonly logger = new Logger(AppMonitorUserController.name)

  constructor(private readonly monitorUserService: AppMonitorUserService) { }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: AppMonitorUserDTOListRequest) {
    return plainToInstance(AppMonitorUserDTOListResponse, await this.monitorUserService.list(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(AppMonitorUserDTOReadResponse, await this.monitorUserService.read(id))
  }

  @Delete('force-quit/:id')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.FORCE_QUIT)
  @WalnutTx()
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.APP_MONITOR_USER,
    action: WalnutAdminConstDecoratorLogOperateAction.DELETE,
    operateType: WalnutAdminConstDecoratorLogOperateType.APP_MONITOR_USER_FORCE_QUIT,
  })
  async forceQuit(
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    // B7b 归一：signout 的 refresh 写腿迁 PG —— 单 em
    return this.monitorUserService.forceQuitByMonitorId(id, ctx.em)
  }

  @Post('state')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardCapFree()
  @WalnutAdminGuardDeviceFree()
  @WalnutTx()
  async monitor(
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() data: AppMonitorUserDTOUpdateState,
  ) {
    return this.monitorUserService.updateState(deviceId, data, ctx.em)
  }
}

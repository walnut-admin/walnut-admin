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
import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle, WalnutAdminConstDecoratorLogOperateType } from '@walnut/const/decorator/logOperate'

import { WalnutDBSession, WalnutDBTransaction } from '@walnut/db'
import { WalnutAdminDecoratorParamMongoId } from '@walnut/decorators/params'
import { ClientSession } from 'mongoose'
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

@Controller('app/monitor/user')
@ApiTags('app/monitor/user')
export class AppMonitorUserController {
  private readonly logger = new Logger(AppMonitorUserController.name)

  constructor(private readonly monitorUserService: AppMonitorUserService) { }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: AppMonitorUserDTOListRequest) {
    return new AppMonitorUserDTOListResponse(
      await this.monitorUserService.list(payload),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new AppMonitorUserDTOReadResponse(
      (await this.monitorUserService.read(id)).toObject(),
    )
  }

  @Delete('force-quit/:id')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.FORCE_QUIT)
  @WalnutDBTransaction()
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.APP_MONITOR_USER,
    action: WalnutAdminConstDecoratorLogOperateAction.DELETE,
    operateType: WalnutAdminConstDecoratorLogOperateType.APP_MONITOR_USER_FORCE_QUIT,
  })
  async forceQuit(
    @WalnutDBSession() dbSession: ClientSession,
    @WalnutAdminDecoratorParamMongoId() id: string,
  ) {
    return this.monitorUserService.forceQuitByMonitorId(id, dbSession)
  }

  @Post('state')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardCapFree()
  @WalnutAdminGuardDeviceFree()
  @WalnutDBTransaction()
  async monitor(
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() dbSession: ClientSession,
    @Body() data: AppMonitorUserDTOUpdateState,
  ) {
    return this.monitorUserService.updateState(deviceId, data, dbSession)
  }
}

import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { plainToInstance } from 'class-transformer'

import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorOperateLog } from '@/decorators/walnut/log.operate.decorator'
import { WalnutAdminGuardCapFree } from '@/guard/cap.guard'
import { WalnutAdminGuardDeviceFree } from '@/guard/device.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { WalnutAdminDecoratorThrottle } from '@/guard/throttler.guard'
import { WalnutAdminGuardJwtFree } from '@/modules/auth/modules/jwt/jwt-access.guard'
import { AppTechCookieService } from '@/modules/techniques/cookie/cookie.service'
import { SysUserDTOReadResponse } from '../user/dto/user.dto'
import { SysDeviceService } from './device.service'
import { SysDeviceSettingService } from './device.setting.service'
import { assembleSysDevice, SysDeviceDTOHistoryUsersResponse, SysDeviceDTOInitialRequest, SysDeviceDTOInitialResponse, SysDeviceDTOListRequest, SysDeviceDTOListResponse, SysDeviceDTOReadResponse, SysDeviceDTOSafe } from './dto/device.dto'

const Permissions = {
  READ: 'system:device:read',
  LIST: 'system:device:list',
  GET_CURRENT_USER: 'system:device:getCurrentUser',
  GET_HISTORY_USERS: 'system:device:getHistoryUsers',
  LOCK: 'system:device:lock',
  UNLOCK: 'system:device:unlock',
  BANNED: 'system:device:ban',
  UNBANNED: 'system:device:unban',
} as const

const {
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.DEVICE,
  DTO: SysDeviceDTOSafe,
})

/**
 * B6 迁移（controller 层，B1 同款）：路由参数 ParamMongoId → uuid 参数装饰器；
 * 事务句柄 `ctx.dbSession` → `ctx.em`；`.toObject()` 移除，出参统一 plainToInstance，
 * 实体经 assembleSysDevice 组装回 Mongo 版嵌套形态（sr/vp/geoLocation 拍平列还原）。
 */
@Controller('system/device')
@ApiTags('system/device')
export class SysDeviceController {
  constructor(
    private readonly deviceService: SysDeviceService,
    private readonly cookieService: AppTechCookieService,
  ) { }

  @Post('initial')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardCapFree()
  @WalnutAdminGuardDeviceFree()
  @WalnutTx()
  @WalnutAdminDecoratorThrottle(SysDeviceSettingService)
  async initial(
    @WalnutTxSession() ctx: WalnutTxContext,
    @Req() req: IWalnutAdminExpressRequest,
    @Body() payload: SysDeviceDTOInitialRequest,
  ) {
    const { deviceId, locationInfo } = await this.deviceService.initial(req, payload, ctx.em)

    const maxAge = 30 * 24 * 60 * 60 * 1000
    // set device id cookie
    this.cookieService.setResponseCookie(req, [
      {
        key: WalnutAdminConstCookieKeys.DEVICE_ID,
        value: deviceId,
        options: {
          maxAge,
        },
      },
    ])

    return new SysDeviceDTOInitialResponse({
      deviceId,
      latitude: locationInfo.latitude,
      longitude: locationInfo.longitude,
      countryCode: locationInfo.countryCode,
    })
  }

  @Get(':id/current-active-user')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.GET_CURRENT_USER], 'and')
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device ID',
  })
  @ApiWalnutOkResponse({
    description: 'get current user of device',
    DTO: SysUserDTOReadResponse,
  })
  async getCurrentUser(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysUserDTOReadResponse, (await this.deviceService.getCurrentActiveUser(id)) ?? {})
  }

  @Get(':id/history-users')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.GET_HISTORY_USERS], 'and')
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device ID',
  })
  @ApiWalnutOkResponse({
    description: 'get history users of current device',
    DTO: SysDeviceDTOHistoryUsersResponse,
  })
  async getHistoryUsers(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysDeviceDTOHistoryUsersResponse, await this.deviceService.getHistoryUsersByDeviceId(id))
  }

  @Patch(':id/lock')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.LOCK], 'and')
  @WalnutTx()
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device ID',
  })
  @ApiWalnutOkResponse({
    description: 'lock current device',
    primitive: 'boolean',
  })
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.DEVICE,
    action: WalnutAdminConstDecoratorLogOperateAction.UPDATE,
    operateType: WalnutAdminConstDecoratorLogOperateType.DEVICE_LOCK,
  })
  async lock(
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return this.deviceService.lock(id, ctx.em)
  }

  @Patch(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.UNLOCK], 'and')
  @WalnutTx()
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device ID',
  })
  @ApiWalnutOkResponse({
    description: 'unlock current device',
    primitive: 'boolean',
  })
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.USER,
    action: WalnutAdminConstDecoratorLogOperateAction.UPDATE,
    operateType: WalnutAdminConstDecoratorLogOperateType.DEVICE_UNLOCK,
  })
  async unlock(
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return this.deviceService.unlock(id, ctx.em)
  }

  @Patch(':id/ban')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.BANNED], 'and')
  @WalnutTx()
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device ID',
  })
  @ApiWalnutOkResponse({
    description: 'ban current device',
    primitive: 'boolean',
  })
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.USER,
    action: WalnutAdminConstDecoratorLogOperateAction.UPDATE,
    operateType: WalnutAdminConstDecoratorLogOperateType.DEVICE_BAN,
  })
  async ban(
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return this.deviceService.ban(id, ctx.em)
  }

  @Patch(':id/unban')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.UNBANNED], 'and')
  @WalnutTx()
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device ID',
  })
  @ApiWalnutOkResponse({
    description: 'unban current device',
    primitive: 'boolean',
  })
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.USER,
    action: WalnutAdminConstDecoratorLogOperateAction.UPDATE,
    operateType: WalnutAdminConstDecoratorLogOperateType.DEVICE_UNBAN,
  })
  async unban(
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return this.deviceService.unban(id, ctx.em)
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(
      SysDeviceDTOReadResponse,
      assembleSysDevice(await this.deviceService.read(id)),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysDeviceDTOListRequest) {
    const result = await this.deviceService.list(payload)

    return plainToInstance(SysDeviceDTOListResponse, {
      ...result,
      data: result.data.map(assembleSysDevice),
    })
  }
}

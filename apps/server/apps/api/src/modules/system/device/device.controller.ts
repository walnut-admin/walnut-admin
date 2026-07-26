import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { WalnutAdminDecoratorParamMongoId } from '@walnut-server/decorators/params'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { ClientSession } from 'mongoose'
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
import { SysDeviceDTOHistoryUsersResponse, SysDeviceDTOInitialRequest, SysDeviceDTOInitialResponse, SysDeviceDTOListRequest, SysDeviceDTOListResponse, SysDeviceDTOReadResponse, SysDeviceDTOSafe } from './dto/device.dto'

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
  @WalnutDBTransaction()
  @WalnutAdminDecoratorThrottle(SysDeviceSettingService)
  async initial(
    @WalnutDBSession() dbSession: ClientSession,
    @Req() req: IWalnutAdminExpressRequest,
    @Body() payload: SysDeviceDTOInitialRequest,
  ) {
    const { deviceId, locationInfo } = await this.deviceService.initial(req, payload, dbSession)

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
    description: 'Device MongoDB ID',
  })
  @ApiWalnutOkResponse({
    description: 'get current user of device',
    DTO: SysUserDTOReadResponse,
  })
  async getCurrentUser(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SysUserDTOReadResponse((await this.deviceService.getCurrentActiveUser(id))?.toObject())
  }

  @Get(':id/history-users')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.GET_HISTORY_USERS], 'and')
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device MongoDB ID',
  })
  @ApiWalnutOkResponse({
    description: 'get history users of current device',
    DTO: SysDeviceDTOHistoryUsersResponse,
  })
  async getHistoryUsers(@WalnutAdminDecoratorParamMongoId() id: string) {
    return (await this.deviceService.getHistoryUsersByDeviceId(id)).map(i => new SysDeviceDTOHistoryUsersResponse(i))
  }

  @Patch(':id/lock')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.LOCK], 'and')
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device MongoDB ID',
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
  async lock(@WalnutAdminDecoratorParamMongoId() id: string) {
    return this.deviceService.lock(id)
  }

  @Patch(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.UNLOCK], 'and')
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device MongoDB ID',
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
  async unlock(@WalnutAdminDecoratorParamMongoId() id: string) {
    return this.deviceService.unlock(id)
  }

  @Patch(':id/ban')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.BANNED], 'and')
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device MongoDB ID',
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
  async ban(@WalnutAdminDecoratorParamMongoId() id: string) {
    return this.deviceService.ban(id)
  }

  @Patch(':id/unban')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.UNBANNED], 'and')
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Device MongoDB ID',
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
  async unban(@WalnutAdminDecoratorParamMongoId() id: string) {
    return this.deviceService.unban(id)
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SysDeviceDTOReadResponse(
      (await this.deviceService.read(id)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysDeviceDTOListRequest) {
    return new SysDeviceDTOListResponse(
      await this.deviceService.list(payload),
    )
  }
}

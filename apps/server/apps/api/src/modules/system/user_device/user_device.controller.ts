import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { ClientSession } from 'mongoose'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { SysUserLockUnLockDto } from '../user_lock/dto/user_lock.dto'
import { SysUserDeviceListDTO, SysUserDeviceUpdateNameDTO } from './dto/user_device.dto'
import { SysUserDeviceService } from './user_device.service'

const Permissions = {
  LIST: 'system:user:device:list',
  UPDATE_NAME: 'system:user:device:updateName',
  FORCE_QUIT: 'system:user:device:forceQuit',
  LOCK: 'system:user:device:lock',
  UNLOCK: 'system:user:device:unlock',
} as const

@Controller('system/user/device')
@ApiTags('system/user/device')
export class SysUserDeviceController {
  constructor(private readonly userDeviceService: SysUserDeviceService) {}

  @Get('list')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @ApiWalnutOkResponse({
    description: 'get security tab1 status',
    DTO: SysUserDeviceListDTO,
  })
  async getCurrentUserDeviceList(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
  ) {
    const list = await this.userDeviceService.getCurrentUserDeviceList(user.userId, deviceId)
    return new SysUserDeviceListDTO({
      data: list,
      total: list.length,
    })
  }

  @Put('update-name/:deviceId')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE_NAME)
  @ApiWalnutOkResponse({
    description: 'update user device name',
    primitive: 'boolean',
  })
  async updateUserDeviceName(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Param('deviceId') deviceId: string,
    @Body() body: SysUserDeviceUpdateNameDTO,
  ) {
    await this.userDeviceService.updateUserDeviceName(user.userId, deviceId, body.deviceName)
    return true
  }

  @Delete('force-quit/:deviceId')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.FORCE_QUIT)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'force quit user device',
    primitive: 'boolean',
  })
  async forceQuitUserDevice(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
    @Param('deviceId') deviceId: string,
  ) {
    await this.userDeviceService.forceQuitUserDevice(user.userId, deviceId, dbSession)
    return true
  }

  @Put('lock/:deviceId')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.LOCK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'lock user device',
    primitive: 'boolean',
  })
  async lockUserDevice(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
    @Param('deviceId') deviceId: string,
  ) {
    await this.userDeviceService.lockUserDeviceWithUserIdAndDeviceId(user.userId, deviceId, dbSession)
    return true
  }

  @Put('unlock/:deviceId')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.UNLOCK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'unlock user device',
    primitive: 'boolean',
  })
  async unlockUserDevice(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
    @Param('deviceId') deviceId: string,
    @Body() body: SysUserLockUnLockDto,
  ) {
    await this.userDeviceService.unlockUserDeviceWithUserIdAndDeviceId(user.userId, deviceId, body.lockPwdHash!, dbSession)
    return true
  }
}

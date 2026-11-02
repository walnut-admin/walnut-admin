import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorUser } from '@walnut-server/guards'

import { SysUserDeviceListDTO, SysUserDeviceService, SysUserDeviceUpdateNameDTO, SysUserLockUnLockDto } from '@walnut-server/identity'
import { WalnutAdminPipeDeviceId } from '@walnut-server/pipes'
import { SystemRoutes } from '@walnut/contract'
import { plainToInstance } from 'class-transformer'

const Permissions = {
  LIST: 'system:user:device:list',
  UPDATE_NAME: 'system:user:device:updateName',
  FORCE_QUIT: 'system:user:device:forceQuit',
  LOCK: 'system:user:device:lock',
  UNLOCK: 'system:user:device:unlock',
} as const

/**
 * B6 迁移（controller 层）：数据面 PG 写走 `ctx.em`。B7b 归一：doSignout /
 * user_lock preference 的写腿亦迁 PG —— 双句柄收成单 `ctx.em`。
 */
@Controller(SystemRoutes.USER_DEVICE)
@ApiTags('system/user/device')
export class SysUserDeviceController {
  constructor(private readonly userDeviceService: SysUserDeviceService) {}

  @Get('list')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @ApiWalnutOkResponse({
    // F-21：原描述是复制粘贴残留（'get security tab1 status'），实现是「当前用户的设备列表」
    description: 'get current user device list',
    DTO: SysUserDeviceListDTO,
  })
  async getCurrentUserDeviceList(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
  ) {
    const list = await this.userDeviceService.getCurrentUserDeviceList(user.userId, deviceId)
    return plainToInstance(SysUserDeviceListDTO, {
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
    @Param('deviceId', new WalnutAdminPipeDeviceId()) deviceId: string,
    @Body() body: SysUserDeviceUpdateNameDTO,
  ) {
    await this.userDeviceService.updateUserDeviceName(user.userId, deviceId, body.deviceName)
    return true
  }

  @Delete('force-quit/:deviceId')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.FORCE_QUIT)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'force quit user device',
    primitive: 'boolean',
  })
  async forceQuitUserDevice(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('deviceId', new WalnutAdminPipeDeviceId()) deviceId: string,
  ) {
    await this.userDeviceService.forceQuitUserDevice(user.userId, deviceId, ctx.em)
    return true
  }

  @Put('lock/:deviceId')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.LOCK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'lock user device',
    primitive: 'boolean',
  })
  async lockUserDevice(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('deviceId', new WalnutAdminPipeDeviceId()) deviceId: string,
  ) {
    await this.userDeviceService.lockUserDeviceWithUserIdAndDeviceId(user.userId, deviceId, ctx.em)
    return true
  }

  @Put('unlock/:deviceId')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.UNLOCK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'unlock user device',
    primitive: 'boolean',
  })
  async unlockUserDevice(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('deviceId', new WalnutAdminPipeDeviceId()) deviceId: string,
    @Body() body: SysUserLockUnLockDto,
  ) {
    // F-28：`SysUserLockUnLockDto` 是 RealPartialType ⇒ lockPwdHash 可缺省，而「非 security
    // 锁屏模式不需要解锁密码」是现状语义（shared service 的 hasPwd 判定把 '' / null /
    // undefined 视为同一件事：未提交密码）。这里显式归一成空串，去掉掩盖可空契约的
    // 非空断言；security 模式下缺密码仍由 shared service 报受控 40000，行为不变。
    const lockPwdHash = body.lockPwdHash ?? ''

    await this.userDeviceService.unlockUserDeviceWithUserIdAndDeviceId(user.userId, deviceId, lockPwdHash, ctx.em)
    return true
  }
}

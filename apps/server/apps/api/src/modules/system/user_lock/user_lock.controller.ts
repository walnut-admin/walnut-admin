import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Request } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { WalnutDBSession, WalnutDBTransaction } from '@walnut/db'
import { ApiWalnutOkResponse } from '@walnut/decorators/swagger/response.decorator'
import { ClientSession } from 'mongoose'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { SysUserLockDoLockDto, SysUserLockPreferenceDTO, SysUserLockUnLockDto } from './dto/user_lock.dto'
import { SysUserLockService } from './user_lock.service'

@Controller('system/user/lock')
@ApiTags('system/user/lock')
export class SysUserLockController {
  constructor(
    private readonly lockService: SysUserLockService,
  ) {}

  @Get('read')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @ApiWalnutOkResponse({
    description: 'Get current user lock status',
    primitive: 'boolean',
  })
  async get(@WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload, @WalnutAdminDecoratorDeviceId() deviceId: string) {
    const res = await this.lockService.getLockStatusForUser(user?.userId, deviceId)
    return new SysUserLockPreferenceDTO(res)
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Lock current user account',
    primitive: 'boolean',
  })
  async lock(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() session: ClientSession,
    @Request() req: IWalnutAdminExpressRequest,
    @Body() payload: SysUserLockDoLockDto,
  ) {
    return this.lockService.lock(user.userId, deviceId, req.fingerprint, payload, session)
  }

  @Patch('unlock')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Unlock current user account',
    primitive: 'boolean',
  })
  async unlock(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() session: ClientSession,
    @Request() req: IWalnutAdminExpressRequest,
    @Body() payload: SysUserLockUnLockDto,
  ) {
    return this.lockService.unlock(user.userId, deviceId, req.fingerprint, payload, session)
  }
}

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IWalnutAdminConstRoleMode, WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { WalnutAdminDecoratorParamMongoId } from '@walnut-server/decorators/params'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminPipeParamEnum } from '@walnut-server/pipes'
import { } from '@walnut/contract'
import { ClientSession } from 'mongoose'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { SysUserDTOSafe } from '../dto/user.dto'
import { SysUserMeDTOUpdateProfileRequest } from '../dto/user.me.dto'
import { SysUserMeService } from '../services/user.me.service'

const Permissions = {
  UPDATE_PROFILE: 'system:user:updateProfile',
} as const

@Controller('system/user/me')
@ApiTags('system/user/me')
export class SysUserMeController {
  constructor(
    private readonly userMeService: SysUserMeService,
  ) { }

  @Put('profile')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE_PROFILE)
  @ApiWalnutOkResponse({
    description: 'update profile',
    DTO: SysUserDTOSafe,
  })
  async updateProfile(@WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload, @Body() payload: SysUserMeDTOUpdateProfileRequest) {
    const profile = await this.userMeService.updateProfile(user.userId, payload)
    return new SysUserDTOSafe(profile?.toObject())
  }

  // TODO should remove
  @Get('security-tab2')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'get security tab2 status',
    DTO: null,
  })
  async getSecurityTab2Status(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
  ) {
    return this.userMeService.getSecurityTab2Status(user.userId, dbSession)
  }

  @Get('profile')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'Get current user profile',
    DTO: SysUserDTOSafe,
  })
  async getProfile(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
  ) {
    const res = await this.userMeService.getUserProfile(user.userId)
    return new SysUserDTOSafe(res?.toObject())
  }

  @Patch('role/switch/:roleId')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'switch role, notice that front end need to get new access token after this operation',
    primitive: 'boolean',
  })
  async switchRole(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorParamMongoId('roleId') roleId: string,
  ) {
    await this.userMeService.switchRole(user.userId, roleId)
    return true
  }

  @Patch('roleMode/switch/:roleMode')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'switch role mode, notice that front end need to get new access token after this operation',
    primitive: 'boolean',
  })
  async switchRoleMode(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Param('roleMode', new WalnutAdminPipeParamEnum(WalnutAdminConstRoleMode)) roleMode: IWalnutAdminConstRoleMode,
  ) {
    await this.userMeService.switchRoleMode(user.userId, roleMode)
    return true
  }
}

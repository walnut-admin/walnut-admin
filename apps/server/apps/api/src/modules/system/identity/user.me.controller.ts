import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IWalnutAdminConstRoleMode, WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorUser } from '@walnut-server/guards'
import { SysUserMeService } from '@walnut-server/identity'

import { WalnutAdminPipeParamEnum } from '@walnut-server/pipes'
import { SystemRoutes } from '@walnut/contract'
import { plainToInstance } from 'class-transformer'
import { SysUserDTOSafe } from '@/modules/system/user/dto/user.dto'
import { SysUserMeDTOUpdateProfileRequest, SysUserMeSecurityTab2ResponseDTO } from '@/modules/system/user/dto/user.me.dto'

const Permissions = {
  UPDATE_PROFILE: 'system:user:updateProfile',
} as const

@Controller(SystemRoutes.USER_ME)
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
    return plainToInstance(SysUserDTOSafe, profile)
  }

  // TODO should remove
  @Get('security-tab2')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'get security tab2 status',
    DTO: SysUserMeSecurityTab2ResponseDTO,
  })
  async getSecurityTab2Status(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
  ) {
    // B7b 归一：mfa 状态读腿迁 PG —— 单 em
    return this.userMeService.getSecurityTab2Status(user.userId, ctx.em)
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
    return plainToInstance(SysUserDTOSafe, res)
  }

  @Patch('role/switch/:roleId')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'switch role, notice that front end need to get new access token after this operation',
    primitive: 'boolean',
  })
  async switchRole(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorParamUuid('roleId') roleId: string,
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

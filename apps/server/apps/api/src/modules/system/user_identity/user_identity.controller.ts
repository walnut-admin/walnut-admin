import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Request } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut/db'

import { ApiWalnutOkResponse } from '@walnut/decorators/swagger/response.decorator'
import { WalnutAdminPipeParamEnum } from '@walnut/pipes'
import { ClientSession } from 'mongoose'

import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardRequireSensitive } from '@/guard/sensitive.guard'
import {
  SysUserIdentityBindRequestDTO,
  SysUserIdentityCheckRequestDTO,
  SysUserIdentityDTO,
  SysUserIdentityListDTO,
  SysUserIdentityStatusRequestDTO,
  SysUserIdentityStatusResponseDTO,
  SysUserIdentityUpdateDTO,
  SysUserIdentityVerifyRequestDTO,
} from './dto/user_identity.dto'
import {
  IWalnutAdminConstSysUserIdentityPurpose,
  IWalnutAdminConstSysUserIdentityType,
  WalnutAdminConstSysUserIdentityPurpose,
  WalnutAdminConstSysUserIdentityType,
} from './schema/user_identity.schema'
import { SysUserIdentityService } from './user_identity.service'

@Controller('system/user/identity')
@ApiTags('system/user/identity')
export class SysUserIdentityController {
  constructor(private readonly userIdentityService: SysUserIdentityService) {}

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'List user identities',
    DTO: SysUserIdentityDTO,
    isArray: true,
  })
  async list(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Body() dto: SysUserIdentityListDTO,
  ) {
    return this.userIdentityService.list({ ...dto, userId: user.userId })
  }

  @Get('status/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Get current user identity status',
    DTO: SysUserIdentityStatusResponseDTO,
  })
  async getStatus(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose))
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
  ) {
    return new SysUserIdentityStatusResponseDTO(await this.userIdentityService.getStatus(user.userId, purpose, dbSession))
  }

  @Post('check/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'Pre-bind check: validate uniqueness and send verification code',
    primitive: 'boolean',
  })
  async check(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Request() req: IWalnutAdminExpressRequest,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
    @Body() dto: SysUserIdentityCheckRequestDTO,
  ) {
    await this.userIdentityService.check(user.userId, type, purpose, dto, req.language)
    return true
  }

  @Post('bind/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Bind identity (step 2: verify code and create)',
    primitive: 'boolean',
  })
  async bind(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
    @Body() dto: SysUserIdentityBindRequestDTO,
  ) {
    await this.userIdentityService.bind(user.userId, type, purpose, dto, dbSession)
    return true
  }

  @Delete('unbind/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Unbind identity',
    primitive: 'boolean',
  })
  async unbind(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
  ) {
    await this.userIdentityService.unbind(user.userId, type, purpose, dbSession)
    return true
  }

  @Put('update/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Update identity (rebind)',
    primitive: 'boolean',
  })
  async update(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
    @Body() dto: SysUserIdentityUpdateDTO,
  ) {
    await this.userIdentityService.update(user.userId, type, purpose, dto, dbSession)
    return true
  }

  @Post('send-code/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Send verification code to existing unverified identity',
    primitive: 'boolean',
  })
  async sendCode(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Request() req: IWalnutAdminExpressRequest,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
  ) {
    await this.userIdentityService.sendCode(user.userId, type, purpose, req.language)
    return true
  }

  @Post('verify/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Verify identity',
    primitive: 'boolean',
  })
  async verify(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
    @Body() dto: SysUserIdentityVerifyRequestDTO,
  ) {
    await this.userIdentityService.verify(user.userId, type, purpose, dto, dbSession)
    return true
  }

  @Put('status/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Update identity status (enable/disable)',
    primitive: 'boolean',
  })
  @WalnutAdminGuardRequireSensitive({
    level: 'account_critical',
    type: 'email_status_toggle',
    allowChoose: true,
  })
  async updateStatus(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
    @Body() dto: SysUserIdentityStatusRequestDTO,
  ) {
    await this.userIdentityService.updateStatus(user.userId, type, purpose, dto, dbSession)
    return true
  }
}

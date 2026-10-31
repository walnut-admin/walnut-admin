import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Request } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'

import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorUser, WalnutAdminGuardRequireSensitive } from '@walnut-server/guards'

import {
  IWalnutAdminConstSysUserIdentityPurpose,
  IWalnutAdminConstSysUserIdentityType,
  SysUserIdentityBindRequestDTO,
  SysUserIdentityCheckRequestDTO,
  SysUserIdentityDTO,
  SysUserIdentityListDTO,
  SysUserIdentityService,
  SysUserIdentityStatusRequestDTO,
  SysUserIdentityStatusResponseDTO,
  SysUserIdentityUpdateDTO,
  SysUserIdentityVerifyRequestDTO,
  WalnutAdminConstSysUserIdentityPurpose,
  WalnutAdminConstSysUserIdentityType,
} from '@walnut-server/identity'
import { WalnutAdminPipeParamEnum } from '@walnut-server/pipes'

@Controller('system/user/identity')
@ApiTags('system/user/identity')
export class SysUserIdentityController {
  constructor(private readonly userIdentityService: SysUserIdentityService) {}

  // B7a 迁移：事务句柄统一取 ctx.em（WalnutTxContext 双引擎上下文，已迁侧取 em）

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
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Get current user identity status',
    DTO: SysUserIdentityStatusResponseDTO,
  })
  async getStatus(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose))
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
  ) {
    return new SysUserIdentityStatusResponseDTO(await this.userIdentityService.getStatus(user.userId, purpose, ctx.em))
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
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Bind identity (step 2: verify code and create)',
    primitive: 'boolean',
  })
  async bind(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
    @Body() dto: SysUserIdentityBindRequestDTO,
  ) {
    await this.userIdentityService.bind(user.userId, type, purpose, dto, ctx.em)
    return true
  }

  @Delete('unbind/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Unbind identity',
    primitive: 'boolean',
  })
  // P2-25（2026-10-29）：unbind 没有 bind 的 OTP 码校验，旧实现可无验证地移除登录/安全
  // 身份（password 还跳过 keep-one 判据）。与 status 同级挂 account_critical 敏感守卫：
  // 已验证的安全邮箱/手机可完成验证，缺可用方式时受控 40000（noVerifyMethodAvailable）。
  @WalnutAdminGuardRequireSensitive({
    level: 'account_critical',
    type: 'identity_manage',
    allowChoose: true,
  })
  async unbind(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
  ) {
    await this.userIdentityService.unbind(user.userId, type, purpose, ctx.em)
    return true
  }

  @Put('update/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Update identity (rebind)',
    primitive: 'boolean',
  })
  // P2-25（2026-10-29）：update 的 DTO 含 status —— 旧实现可绕过 status 端点的敏感守卫
  // 直接关闭登录/安全身份。rebind 与 status 同属身份管理面，统一挂 account_critical。
  @WalnutAdminGuardRequireSensitive({
    level: 'account_critical',
    type: 'identity_manage',
    allowChoose: true,
  })
  async update(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
    @Body() dto: SysUserIdentityUpdateDTO,
  ) {
    await this.userIdentityService.update(user.userId, type, purpose, dto, ctx.em)
    return true
  }

  @Post('send-code/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
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
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Verify identity',
    primitive: 'boolean',
  })
  async verify(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
    @Body() dto: SysUserIdentityVerifyRequestDTO,
  ) {
    await this.userIdentityService.verify(user.userId, type, purpose, dto, ctx.em)
    return true
  }

  @Put('status/:type/:purpose')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
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
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityType)) type: IWalnutAdminConstSysUserIdentityType,
    @Param('purpose', new WalnutAdminPipeParamEnum(WalnutAdminConstSysUserIdentityPurpose)) purpose: IWalnutAdminConstSysUserIdentityPurpose,
    @Body() dto: SysUserIdentityStatusRequestDTO,
  ) {
    await this.userIdentityService.updateStatus(user.userId, type, purpose, dto, ctx.em)
    return true
  }
}

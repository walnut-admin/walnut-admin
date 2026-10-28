import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Request } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminPipeParamEnum } from '@walnut-server/pipes'

import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { getOperationStrategy } from './sensitive.config'
import {
  IWalnutAdminConstSecurityLevel,
  IWalnutAdminConstSecuritySensitiveType,
  WalnutAdminConstSecurityLevel,
  WalnutAdminConstSecuritySensitiveType,
} from './sensitive.const'
import {
  SecuritySensitiveCheckResponseDTO,
  SecuritySensitiveVerifyRequestDTO,
} from './sensitive.dto'
import { SecuritySensitiveService } from './sensitive.service'

@Controller('security/sensitive')
@ApiTags('security/sensitive')
export class SecuritySensitiveController {
  constructor(
    private readonly sensitiveService: SecuritySensitiveService,
  ) {}

  /**
   * Check verification status for a security level
   * Called before sensitive operation to determine if verification is needed
   */
  @Get('check')
  async checkVerificationStatus(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Request() req: IWalnutAdminExpressRequest,
    // level/type 枚举闸：裸 query 直进 getOperationStrategy 时，枚举外 level 会在
    // SECURITY_LEVEL_STRATEGIES[level] 上解引用 undefined → TypeError 兜底 50000；
    // 拦成受控 40099
    @Query('level', new WalnutAdminPipeParamEnum(WalnutAdminConstSecurityLevel)) level: IWalnutAdminConstSecurityLevel,
    @Query('type', new WalnutAdminPipeParamEnum(WalnutAdminConstSecuritySensitiveType, { required: false })) operationType?: IWalnutAdminConstSecuritySensitiveType,
  ) {
    const deviceId = getWalnutAdminCookie(req, WalnutAdminConstCookieKeys.DEVICE_ID)
    const strategy = getOperationStrategy(level, operationType)

    const result = await this.sensitiveService.checkVerificationStatus(
      user.userId,
      deviceId,
      level,
      strategy.supportedMethods,
    )

    return new SecuritySensitiveCheckResponseDTO(result)
  }

  /**
   * Verify user identity and grant permission
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Verify identity and grant sensitive permission',
    primitive: 'boolean',
  })
  async verify(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Request() req: IWalnutAdminExpressRequest,
    @Body() dto: SecuritySensitiveVerifyRequestDTO,
  ) {
    const deviceId = getWalnutAdminCookie(req, WalnutAdminConstCookieKeys.DEVICE_ID)
    const strategy = getOperationStrategy(dto.level, dto.operationType)

    await this.sensitiveService.verifyAndGrantPermission(
      user.userId,
      deviceId,
      dto.level,
      dto.operationType!,
      dto.method,
      dto.credential,
      strategy.supportedMethods,
      // B7c 归一：security/sensitive 收口 —— 传 ctx.em（写腿全在 Redis / 已迁 PG 的
      // identity 读腿，事务句柄签名随批次迁 em；上游 em 形参未接线，见 service 注释）
      ctx.em,
    )

    return true
  }
}

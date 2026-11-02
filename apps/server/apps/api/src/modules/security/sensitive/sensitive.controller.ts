import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Request } from '@nestjs/common'
import { ApiQuery, ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { getWalnutAdminCookie } from '@walnut-server/cookie'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { WalnutAdminDecoratorUser } from '@walnut-server/guards'
import { WalnutAdminPipeParamEnum } from '@walnut-server/pipes'
import { getOperationStrategy, IWalnutAdminConstSecurityLevel, IWalnutAdminConstSecuritySensitiveType, SecuritySensitiveCheckResponseDTO, SecuritySensitiveService, SecuritySensitiveVerifyRequestDTO, WalnutAdminConstSecurityLevel, WalnutAdminConstSecuritySensitiveType } from '@walnut-server/security'
import { SecurityRoutes } from '@walnut/contract'

@Controller(SecurityRoutes.SENSITIVE)
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
  // F-07：level/type 是 union 字面量，经 emitDecoratorMetadata 反射成 Object —— 不是 String/Number/
  // Boolean 的 @Query 参数不会被 swagger 自动收编（此前该 op 的 parameters 为空）。显式声明枚举。
  @ApiQuery({
    name: 'level',
    required: true,
    enum: WalnutAdminConstSecurityLevel,
    description: 'security level of the operation to be performed',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: WalnutAdminConstSecuritySensitiveType,
    description: 'sensitive operation type, narrows the strategy (overrides per level)',
  })
  @ApiWalnutOkResponse({
    description: 'Check verification status for a security level',
    DTO: SecuritySensitiveCheckResponseDTO,
  })
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

    // F-28：显式校验替代 `dto.operationType!`。DTO 该字段可空（default: null，缺省 =
    // 按 level 整档策略），枚举校验器在管道层已把「缺省 / null / 枚举外值」拦成受控
    // 40099（WalnutAdminExceptionRequestDataError）；这里再收敛一次是为了类型收窄
    // （权限缓存里的 operationType 不接受 null）—— 万一上游改动让 null 漏进来，也停在
    // 同一个受控 40099，而不是把 null 写进 Redis。
    const operationType = dto.operationType ?? null

    if (operationType === null) {
      throw new WalnutAdminExceptionRequestDataError('operationType is required for sensitive verification')
    }

    const strategy = getOperationStrategy(dto.level, operationType)

    await this.sensitiveService.verifyAndGrantPermission(
      user.userId,
      deviceId,
      dto.level,
      operationType,
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

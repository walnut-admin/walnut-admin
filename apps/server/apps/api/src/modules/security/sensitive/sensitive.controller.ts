import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Request } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { ClientSession } from 'mongoose'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { getOperationStrategy } from './sensitive.config'
import {
  IWalnutAdminConstSecurityLevel,
  IWalnutAdminConstSecuritySensitiveType,
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
    @Query('level') level: IWalnutAdminConstSecurityLevel,
    @Query('type') operationType?: IWalnutAdminConstSecuritySensitiveType,
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
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Verify identity and grant sensitive permission',
    primitive: 'boolean',
  })
  async verify(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() dbSession: ClientSession,
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
      dbSession,
    )

    return true
  }
}

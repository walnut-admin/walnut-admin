import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutDBSession, WalnutDBTransaction, WalnutTxContext } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorJti, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardMFAFree } from '@/guard/mfa.guard'
import { AuthSuccessDTO } from '../../dto/auth.dto'
import { AuthMfaStatusDTO, AuthMfaVerifyDTO } from './mfa.dto'
import { AuthMfaService } from './mfa.service'

@Controller('auth/mfa')
@ApiTags('auth/mfa')
@WalnutAdminGuardMFAFree()
@WalnutAdminGuardLockFree()
export class AuthMfaController {
  constructor(
    private readonly authMfaService: AuthMfaService,
  ) { }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description:
      'get available mfa methods and status',
    DTO: AuthMfaStatusDTO,
    isArray: true,
  })
  async getAvailableMethods(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() ctx: WalnutTxContext,
  ) {
    const res = await this.authMfaService.getMfaStatus(user.userId, deviceId, ctx.em)
    return res.map(item => new AuthMfaStatusDTO(item))
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description:
      'verify mfa status and return new accessToken when setup mfa',
    DTO: AuthSuccessDTO,
  })
  async verify(
    @WalnutAdminDecoratorJti() jti: string,
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() ctx: WalnutTxContext,
    @Body() dto: AuthMfaVerifyDTO,
  ) {
    // B7b 归一：mfa 状态读腿 / user.mfaSetup 写腿 / post verification 全为 PG —— 单 em
    const newAccessToken = await this.authMfaService.verifyMfaStatus(jti, dto, user.userId, user.sid!, deviceId, ctx.em)
    return new AuthSuccessDTO({ accessToken: newAccessToken })
  }
}

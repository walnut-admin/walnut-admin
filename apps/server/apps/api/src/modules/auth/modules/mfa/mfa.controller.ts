import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorJti, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardMFAFree } from '@/guard/mfa.guard'
import { AuthSuccessDTO } from '../../dto/auth.dto'
import { AuthCookieService } from '../cookie/cookie.service'
import { AuthMfaStatusDTO, AuthMfaVerifyDTO } from './mfa.dto'
import { AuthMfaService } from './mfa.service'

@Controller('auth/mfa')
@ApiTags('auth/mfa')
@WalnutAdminGuardMFAFree()
@WalnutAdminGuardLockFree()
export class AuthMfaController {
  constructor(
    private readonly authMfaService: AuthMfaService,
    private readonly authCookieService: AuthCookieService,
  ) { }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description:
      'get available mfa methods and status',
    DTO: AuthMfaStatusDTO,
    isArray: true,
  })
  async getAvailableMethods(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
  ) {
    const res = await this.authMfaService.getMfaStatus(user.userId, deviceId, ctx.em)
    return res.map(item => new AuthMfaStatusDTO(item))
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description:
      'verify mfa status and return new accessToken when setup mfa',
    DTO: AuthSuccessDTO,
  })
  async verify(
    @WalnutAdminDecoratorJti() jti: string,
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Req() req: IWalnutAdminExpressRequest,
    @Body() dto: AuthMfaVerifyDTO,
  ) {
    // B7b 归一：mfa 状态读腿 / user.mfaSetup 写腿 / post verification 全为 PG —— 单 em
    // revoke-and-insert（2026-10-27）：verify 链轮换 RT —— 新 jti 必须回种 cookie
    // （原地换锁时代旧 jti 恒有效所以本端点从不需要设 cookie，该侥幸随行级撤销终止）
    const { accessToken, jti: newJti } = await this.authMfaService.verifyMfaStatus(jti, dto, user.userId, user.sid!, deviceId, ctx.em)
    this.authCookieService.setRTJtiCookie(req, newJti)
    return new AuthSuccessDTO({ accessToken })
  }
}

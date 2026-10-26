import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutDBSession, WalnutDBTransaction, WalnutTxContext } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorJti } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardDeviceFree } from '@/guard/device.guard'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardMFAFree } from '@/guard/mfa.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { AuthSuccessDTO } from '../../dto/auth.dto'
import { AuthCookieService } from '../cookie/cookie.service'
import { WalnutAdminGuardJwtFree } from '../jwt/jwt-access.guard'
import { JwtRefreshGuard } from './refresh.guard'
import { AuthRefreshSharedService } from './shared/refresh.shared.service'

@Controller('auth/refresh')
@ApiTags('auth/refresh')
export class AuthRefreshController {
  constructor(
    private readonly authRefreshSharedService: AuthRefreshSharedService,
    private readonly authCookieService: AuthCookieService,
  ) { }

  @Post()
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardMFAFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardDeviceFree()
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description:
      'Use jti to get new accessToken & refresh token',
    DTO: AuthSuccessDTO,
  })
  @UseGuards(JwtRefreshGuard)
  async refreshAccessTokenByRefreshToken(
    @WalnutAdminDecoratorJti() jti: string,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() ctx: WalnutTxContext,
    @Req() req: IWalnutAdminExpressRequest,
  ) {
    // B7b 归一：refresh 表写腿迁 PG —— 双句柄收成单 em（轮换事务全 PG）
    // P0-1（2026-10-26 修复）：JwtRefreshGuard 已把入口时刻的 encrypted_token 快照挂
    // `req.realRefreshTokenEncrypted` —— 传入轮换锁内做呈献比对，拦并发/顺序重放
    const newAccessToken = await this.authRefreshSharedService.getNewAccessToken(
      jti,
      deviceId,
      req.RT.sid,
      req.realRefreshTokenEncrypted,
      ctx.em,
    )

    // set refresh token jti to cookie
    this.authCookieService.setRTJtiCookie(req, jti)

    return new AuthSuccessDTO({
      accessToken: newAccessToken,
    })
  }
}

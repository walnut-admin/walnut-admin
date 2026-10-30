import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminDecoratorDataScopeSystemChannel } from '@/decorators/walnut/dataScope.decorator'
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
// 数据权限三期：刷新链系统通道（无 AT，按 refresh token 读 sys_user）
@WalnutAdminDecoratorDataScopeSystemChannel()
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
  @WalnutTx()
  @ApiWalnutOkResponse({
    description:
      'Use jti to get new accessToken & refresh token',
    DTO: AuthSuccessDTO,
  })
  @UseGuards(JwtRefreshGuard)
  async refreshAccessTokenByRefreshToken(
    @WalnutAdminDecoratorJti() jti: string,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Req() req: IWalnutAdminExpressRequest,
  ) {
    // B7b 归一：refresh 表写腿迁 PG —— 双句柄收成单 em（轮换事务全 PG）
    // revoke-and-insert（2026-10-27）：旧 jti 行已撤销、INSERT 新行 —— jti 必须用
    // 返回的新 jti 回种 cookie，客户端下次 refresh 才拿得到现役行
    const { accessToken, jti: newJti } = await this.authRefreshSharedService.getNewAccessToken(
      jti,
      deviceId,
      req.RT.sid,
      ctx.em,
    )

    // set refresh token jti to cookie
    this.authCookieService.setRTJtiCookie(req, newJti)

    return new AuthSuccessDTO({
      accessToken,
    })
  }
}

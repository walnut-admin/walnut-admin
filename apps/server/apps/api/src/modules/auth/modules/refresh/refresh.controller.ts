import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { AuthCookieService, AuthRefreshSharedService, AuthSuccessDTO, WalnutAdminGuardJwtFree } from '@walnut-server/auth'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorDataScopeSystemChannel, WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorJti, WalnutAdminGuardLockFree, WalnutAdminGuardMFAFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { AuthRoutes } from '@walnut/contract'
import { JwtRefreshGuard } from './refresh.guard'

@Controller(AuthRoutes.REFRESH)
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
  // 拍板-4：**不再 DeviceFree** —— 已封禁/锁定的设备不得续 AT（DeviceGuard 的 40606/40607
  // 在这里生效；顺带也让「cookie 滑动续期」在 refresh 上照样生效）。刷新链本来就必须
  // 带 DEVICE_ID cookie（RT 行按 deviceId 校验），拆掉 DeviceFree 不会影响可用性。
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

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiTags,
} from '@nestjs/swagger'
import { AuthCorePermissionsDTO, AuthSecretKeysResponseDTO, AuthService, WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'

import { AppTechCookieService } from '@walnut-server/cookie'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorEncryptResponse, WalnutAdminDecoratorJti, WalnutAdminDecoratorUser, WalnutAdminGuardDeviceFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { AuthRoutes } from '@walnut/contract'
import { JwtRefreshGuard } from './modules/refresh/refresh.guard'

@Controller(AuthRoutes.BASE)
@ApiTags('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: AppTechCookieService,
  ) { }

  @Get('permissions')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'Get current user permission menus',
    DTO: AuthCorePermissionsDTO,
  })
  async getPermission(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
  ) {
    const res = await this.authService.getAuthPermissions(user, deviceId)
    return new AuthCorePermissionsDTO(res)
  }

  @Post('signout')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardSignFree()
  // B7（批次 7）：**凭 RT 登出** —— AT 过期也必须能登出，否则服务端那枚 RT 继续现役
  // （拍板 Q4-a）—— 正文理由：AT 一过期就 40101，用户既登不出去、RT 还继续现役。
  // RT 行给出（行上带 userId / deviceId），AT 不再参与；MFA / Lock 两个 guard 对「无 user」
  // 自跳过，CAP / Risk / Throttler 照常生效。
  // 顺序按 eslint `local/sort-nestjs-decorators` 的顺序表：SignFree → JwtFree → DeviceFree →
  // WalnutTx → ApiWalnutOkResponse → UseGuards（UseGuards 恒在末位）。
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardDeviceFree()
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Signout, remove refresh token in db',
    primitive: 'boolean',
  })
  @UseGuards(JwtRefreshGuard)
  async signout(
    @WalnutAdminDecoratorJti() jti: string,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Req() req: IWalnutAdminExpressRequest,
  ) {
    // B7b 归一：signout 的 refresh 写腿迁 PG —— 单 em；B7（批次 7）身份从 RT 认
    await this.authService.signoutByRefreshToken(
      { jti, sid: req.RT.sid, deviceId, ip: req.realIp },
      ctx.em,
    )
    // clear refresh token in cookie
    this.cookieService.clearCookie(req, [{ key: WalnutAdminConstCookieKeys.RT_JTI }])
    return true
  }

  // TODO change controller
  @Get('keys')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'get secret keys (B is an RSA envelope payload string)',
    DTO: AuthSecretKeysResponseDTO,
  })
  @WalnutAdminDecoratorEncryptResponse('B')
  async getSecretKeys() {
    return this.authService.getSecretKeys()
  }
}

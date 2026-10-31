import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common'
import {
  ApiTags,
} from '@nestjs/swagger'
import { AuthCorePermissionsDTO, AuthSecretKeysResponseDTO, AuthService } from '@walnut-server/auth'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'

import { AppTechCookieService } from '@walnut-server/cookie'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorEncryptResponse, WalnutAdminDecoratorUser, WalnutAdminGuardDeviceFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'

@Controller('auth')
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
  @WalnutAdminGuardDeviceFree()
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Signout, remove refresh token in db',
    primitive: 'boolean',
  })
  async signout(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Req() req: IWalnutAdminExpressRequest,
  ) {
    // B7b 归一：signout 的 refresh 写腿迁 PG —— 单 em
    await this.authService.signout(user, deviceId, req.realIp, ctx.em)
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

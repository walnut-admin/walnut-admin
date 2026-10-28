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
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger'

import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardDeviceFree } from '@/guard/device.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { WalnutAdminDecoratorEncryptResponse } from '../../decorators/walnut/crypto.decorator'
import { AppTechCookieService } from '../techniques/cookie/cookie.service'
import { AuthService } from './auth.service'
import { AuthCorePermissionsDTO } from './dto/auth.dto'

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
  // TODO dto
  @Get('keys')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorEncryptResponse('B')
  async getSecretKeys() {
    return this.authService.getSecretKeys()
  }
}

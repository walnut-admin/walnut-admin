import { Controller, HttpCode, HttpStatus, Logger, Post, Request, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { AuthCookieService, AuthGoogleService, AuthSuccessDTO, WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'

import { IWalnutAdminConstAppSettingAuthOAuthGoogleKeys } from '@walnut-server/const/app/setting'
import { WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorAuthLog, WalnutAdminDecoratorDataScopeSystemChannel, WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorFunctionalGuard, WalnutAdminDecoratorUser, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { AuthRoutes } from '@walnut/contract'
import { AuthGoogleGuard } from './google.guard'

@Controller(AuthRoutes.GOOGLE)
@ApiTags('auth/google')
@WalnutAdminGuardJwtFree()
@WalnutAdminGuardSignFree()
// P1-17（2026-10-28）：Google 登录暂时关闭 —— 未配置（settings 缺失）即 50301，
// 需在 app.auth.google 显式 authEnable=1 才开放。补全（email 复用 + user_identity /
// user_oauth 绑定）前不恢复默认放行。
@WalnutAdminDecoratorFunctionalGuard<IWalnutAdminConstAppSettingAuthOAuthGoogleKeys>(
  WalnutAdminConstAppSettingKeys.APP_AUTH_GOOGLE,
  'authEnable',
  { defaultClosed: true },
)
// 数据权限三期：登录链系统通道（匿名进入，按用户名/oauth 绑定读写 sys_user）
@WalnutAdminDecoratorDataScopeSystemChannel()
export class AuthGoogleController {
  private readonly logger = new Logger(AuthGoogleController.name)

  constructor(
    private readonly authGoogleService: AuthGoogleService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Auth with google fed_cm',
    DTO: AuthSuccessDTO,
  })
  @WalnutAdminDecoratorAuthLog(WalnutAdminConstDecoratorLogAuthType.OAUTH_GOOGLE_FED_CM)
  @UseGuards(AuthGoogleGuard)
  async login(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Request() req: IWalnutAdminExpressRequest,
  ) {
    // B7b 归一：refresh 写腿迁 PG —— 单 em
    const { accessToken, refreshTokenJti, authSessionKey } = await this.authGoogleService.authWithGoogleFedCM(user, deviceId, ctx.em)

    // set refresh token jti to cookie
    this.authCookieService.setRTJtiCookie(req, refreshTokenJti)

    return new AuthSuccessDTO({ accessToken, sessionKey: authSessionKey })
  }
}

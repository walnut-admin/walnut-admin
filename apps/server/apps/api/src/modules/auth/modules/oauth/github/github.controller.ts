import {
  Controller,
  Get,
  Logger,
  Param,
  Query,
  Render,
  Req,
  Request,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiTags } from '@nestjs/swagger'

import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { IWalnutAdminConstAppLanguage } from '@walnut-server/const/app/lang'
import { IWalnutAdminConstAppSettingAuthOAuthGitHubKeys } from '@walnut-server/const/app/setting'
import { WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { ClientSession } from 'mongoose'
import { I18n, I18nContext } from 'nestjs-i18n'
import { WalnutAdminDecoratorFunctionalGuard } from '@/decorators/walnut/functional.decorator'
import { WalnutAdminDecoratorAuthLog } from '@/decorators/walnut/log.auth.decorator'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { SecurityRiskFailedLoginService } from '@/modules/security/risk/modules/failedLogin.service'
import { WalnutAdminConstSysUserIdentityType } from '@/modules/system/user_identity/schema/user_identity.schema'
import { SysUserIdentitySharedService } from '@/modules/system/user_identity/shared/user_identity.shared.service'
import { AppTechSseService } from '@/modules/techniques/sse/sse.service'
import { AuthCookieService } from '../../cookie/cookie.service'
import { WalnutAdminGuardJwtFree } from '../../jwt/jwt-access.guard'
import { AuthSharedService } from '../../shared/shared.service'
import { OAuthGitHubGuard } from './github.guard'
import { OAuthGitHubScope } from './github.strategy'

@Controller('auth/oauth/github')
@ApiTags('auth/oauth/github')
@WalnutAdminDecoratorFunctionalGuard<IWalnutAdminConstAppSettingAuthOAuthGitHubKeys>(WalnutAdminConstAppSettingKeys.APP_AUTH_GITHUB, 'authEnable')
@WalnutAdminGuardJwtFree()
export class OAuthGithubController {
  private readonly logger = new Logger(OAuthGithubController.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly authSharedService: AuthSharedService,
    private readonly sseService: AppTechSseService,
    private readonly authCookieService: AuthCookieService,
    private readonly failedLoginRiskService: SecurityRiskFailedLoginService,
    private readonly userIdentitySharedService: SysUserIdentitySharedService,
  ) { }

  private readonly oauthUrl = 'https://github.com/login/oauth/authorize'

  get clientId() {
    return this.configService.get<string>('auth.github.clientId')
  }

  get callbackURL() {
    return this.configService.get<string>('auth.github.callbackURL')
  }

  private getSseClientId(fp: string): string {
    return `oauth/github/${fp}`
  }

  private getOAuthURL(fp: string, lang: IWalnutAdminConstAppLanguage) {
    const payload = JSON.stringify({ fp, lang })
    return `${this.oauthUrl}?client_id=${this.clientId}&redirect_uri=${this.callbackURL
    }&response_type=code&scope=${OAuthGitHubScope.join('%20')}&state=${payload}`
  }

  @Get('url')
  async OAuth(@Req() req: IWalnutAdminExpressRequest) {
    return this.getOAuthURL(req.fingerprint, req.language)
  }

  @Get('callback')
  @WalnutAdminGuardSignFree()
  @WalnutDBTransaction()
  @WalnutAdminDecoratorAuthLog(WalnutAdminConstDecoratorLogAuthType.OAUTH_GITHUB)
  @Render('template/oauth/done')
  @UseGuards(OAuthGitHubGuard)
  // in order to make @Render work, we need to try/catch below
  // and do not use @UseFilters(OAuthExceptionFilter) like this
  async callback(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() dbSession: ClientSession,
    @Request() req: IWalnutAdminExpressRequest,
    @Query('state') payload: string,
    @I18n() i18n: I18nContext,
  ) {
    let fingerprint: string
    let lang: IWalnutAdminConstAppLanguage

    // safe parse state
    try {
      const parsed = JSON.parse(payload) as { fp: string, lang: IWalnutAdminConstAppLanguage }
      fingerprint = parsed.fp
      lang = parsed.lang || i18n.lang
    }
    catch {
      this.logger.error(`oauth state parse error`)
      lang = i18n.lang as IWalnutAdminConstAppLanguage
      return {
        success: false,
        message: i18n.t('response.40000', { lang }),
      }
    }

    try {
      const { accessToken, refreshTokenJti, authSessionKey } = await this.authSharedService.generateAuthTokens(user, deviceId, dbSession)

      // Mark email identity as verified after successful OAuth validation
      await this.userIdentitySharedService.verifyIdentity(
        user.userId,
        WalnutAdminConstSysUserIdentityType.EMAIL_ADDRESS,
        'login',
        dbSession,
      )

      // Set refresh token jti to cookie
      this.authCookieService.setRTJtiCookie(req, refreshTokenJti)

      const successPayload: IWalnutAdminSseClientData = {
        success: true,
        message: 'success',
        data: {
          event: 'token:github',
          accessToken,
          sessionKey: authSessionKey,
        },
      }

      this.sseService.sendToClient(this.getSseClientId(fingerprint), successPayload)
    }
    catch (exception) {
      const errMsg = exception instanceof Error ? exception.message : 'business.auth.authFailed'
      const translatedMsg: string = i18n.t(errMsg, { lang })
      const errorPayload: IWalnutAdminSseClientData = {
        success: false,
        message: translatedMsg,
        data: {},
      }

      // Record failed login risk
      void this.failedLoginRiskService.collect({
        deviceId,
        identifier: req.identifier,
        ip: req.realIp,
        reason: translatedMsg,
        loginType: WalnutAdminConstDecoratorLogAuthType.OAUTH_GITHUB,
      })

      this.logger.log(`fingerprint: ${fingerprint} => payload: ${JSON.stringify(errorPayload)}`)
      this.sseService.sendToClient(this.getSseClientId(fingerprint), errorPayload)
    }
  }

  @WalnutAdminGuardSignFree()
  @Sse('sse/:fp')
  async sse(@Res() res: IWalnutAdminExpressResponse, @Param('fp') fp: string) {
    const clientId = this.getSseClientId(fp)
    this.sseService.createClient(clientId)
    res.on('close', () => {
      this.sseService.disconnectClient(clientId)
    })
    return this.sseService.getClientObservable(clientId)
  }
}

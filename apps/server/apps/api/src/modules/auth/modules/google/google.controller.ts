import { Controller, HttpCode, HttpStatus, Logger, Post, Request, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { IWalnutAdminConstAppSettingAuthOAuthGoogleKeys } from '@walnut-server/const/app/setting'
import { WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { ClientSession } from 'mongoose'
import { WalnutAdminDecoratorFunctionalGuard } from '@/decorators/walnut/functional.decorator'
import { WalnutAdminDecoratorAuthLog } from '@/decorators/walnut/log.auth.decorator'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { AuthSuccessDTO } from '../../dto/auth.dto'
import { AuthCookieService } from '../cookie/cookie.service'
import { WalnutAdminGuardJwtFree } from '../jwt/jwt-access.guard'
import { AuthGoogleGuard } from './google.guard'
import { AuthGoogleService } from './google.service'

@Controller('auth/google')
@ApiTags('auth/google')
@WalnutAdminGuardJwtFree()
@WalnutAdminGuardSignFree()
@WalnutAdminDecoratorFunctionalGuard<IWalnutAdminConstAppSettingAuthOAuthGoogleKeys>(WalnutAdminConstAppSettingKeys.APP_AUTH_GOOGLE, 'authEnable')
export class AuthGoogleController {
  private readonly logger = new Logger(AuthGoogleController.name)

  constructor(
    private readonly authGoogleService: AuthGoogleService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Auth with google fed_cm',
    DTO: AuthSuccessDTO,
  })
  @WalnutAdminDecoratorAuthLog(WalnutAdminConstDecoratorLogAuthType.OAUTH_GOOGLE_FED_CM)
  @UseGuards(AuthGoogleGuard)
  async login(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() dbSession: ClientSession,
    @Request() req: IWalnutAdminExpressRequest,
  ) {
    const { accessToken, refreshTokenJti, authSessionKey } = await this.authGoogleService.authWithGoogleFedCM(user, deviceId, dbSession)

    // set refresh token jti to cookie
    this.authCookieService.setRTJtiCookie(req, refreshTokenJti)

    return new AuthSuccessDTO({ accessToken, sessionKey: authSessionKey })
  }
}

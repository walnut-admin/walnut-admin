import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { ClientSession } from 'mongoose'
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
    @WalnutDBSession() dbSession: ClientSession,
    @Req() req: IWalnutAdminExpressRequest,
  ) {
    const newAccessToken = await this.authRefreshSharedService.getNewAccessToken(jti, deviceId, req.RT.sid, dbSession)

    // set refresh token jti to cookie
    this.authCookieService.setRTJtiCookie(req, jti)

    return new AuthSuccessDTO({
      accessToken: newAccessToken,
    })
  }
}

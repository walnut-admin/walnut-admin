import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogAuthType } from '@walnut/const/decorator/logAuth'

import { WalnutDBSession, WalnutDBTransaction } from '@walnut/db'
import { ApiWalnutOkResponse } from '@walnut/decorators/swagger/response.decorator'
import { ClientSession } from 'mongoose'
import { WalnutAdminDecoratorAuthLog } from '@/decorators/walnut/log.auth.decorator'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { SysUserIdentitySharedService } from '@/modules/system/user_identity/shared/user_identity.shared.service'
import { AuthSuccessDTO } from '../../dto/auth.dto'
import { AuthCookieService } from '../cookie/cookie.service'
import { WalnutAdminGuardJwtFree } from '../jwt/jwt-access.guard'
import { OtpIdentityTypeMap } from './const/otp.const'
import { OtpSendDTO, OtpVerifyDTO } from './dto/otp.dto'
import { OtpDecoratorFunctionalGuard, OtpDecoratorSendFunctionalGuard, OtpDecoratorThrottle } from './guard/otp.decorator'
import { OtpGuard } from './otp.guard'
import { OtpService } from './otp.service'
import { OtpSettingService } from './otp.setting.service'

@Controller('auth/otp')
@ApiTags('auth/otp')
@WalnutAdminGuardJwtFree()
@OtpDecoratorFunctionalGuard()
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly authCookieService: AuthCookieService,
    private readonly userIdentitySharedService: SysUserIdentitySharedService,
  ) {}

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'Send OTP verification code',
    primitive: 'boolean',
  })
  @OtpDecoratorSendFunctionalGuard()
  @OtpDecoratorThrottle(OtpSettingService)
  async sendOtp(
    @Request() req: IWalnutAdminExpressRequest,
    @Body() payload: OtpSendDTO,
  ) {
    return this.otpService.sendVerifyCode(payload.type, payload.identifier, req.language)
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Auth with OTP (email or SMS) and verify code',
    DTO: AuthSuccessDTO,
  })
  @WalnutAdminDecoratorAuthLog(WalnutAdminConstDecoratorLogAuthType.OTP)
  @UseGuards(OtpGuard)
  async authWithOtp(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() dbSession: ClientSession,
    @Request() req: IWalnutAdminExpressRequest,
    @Body() payload: OtpVerifyDTO,
  ) {
    const { accessToken, refreshTokenJti, authSessionKey } = await this.otpService.authWithOtp(
      payload.type,
      payload.identifier,
      user,
      deviceId,
      dbSession,
    )

    // Mark identity as verified after successful OTP validation
    await this.userIdentitySharedService.verifyIdentity(
      user.userId,
      OtpIdentityTypeMap[payload.type],
      'login',
      dbSession,
    )

    // Set refresh token jti to cookie
    this.authCookieService.setRTJtiCookie(req, refreshTokenJti)

    return new AuthSuccessDTO({ accessToken, sessionKey: authSessionKey })
  }
}

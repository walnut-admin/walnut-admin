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
import { AuthCookieService, AuthSuccessDTO, OtpIdentityTypeMap, OtpSendDTO, OtpService, OtpSettingService, OtpVerifyDTO, WalnutAdminGuardJwtFree } from '@walnut-server/auth'

import { WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorAuthLog, WalnutAdminDecoratorDataScopeSystemChannel, WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorUser } from '@walnut-server/guards'
import { SysUserIdentitySharedService } from '@walnut-server/identity'
import { AuthRoutes } from '@walnut/contract'
import { OtpDecoratorFunctionalGuard, OtpDecoratorSendFunctionalGuard, OtpDecoratorThrottle } from './guard/otp.decorator'
import { OtpGuard } from './otp.guard'

@Controller(AuthRoutes.OTP)
@ApiTags('auth/otp')
@WalnutAdminGuardJwtFree()
@OtpDecoratorFunctionalGuard()
// 数据权限三期：登录链系统通道（匿名进入，按用户名/凭据读 sys_user）
@WalnutAdminDecoratorDataScopeSystemChannel()
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
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Auth with OTP (email or SMS) and verify code',
    DTO: AuthSuccessDTO,
  })
  @WalnutAdminDecoratorAuthLog(WalnutAdminConstDecoratorLogAuthType.OTP)
  @UseGuards(OtpGuard)
  async authWithOtp(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Request() req: IWalnutAdminExpressRequest,
    @Body() payload: OtpVerifyDTO,
  ) {
    const { accessToken, refreshTokenJti, authSessionKey } = await this.otpService.authWithOtp(
      payload.type,
      payload.identifier,
      user,
      deviceId,
      ctx.em,
    )

    // Mark identity as verified after successful OTP validation
    await this.userIdentitySharedService.verifyIdentity(
      user.userId,
      OtpIdentityTypeMap[payload.type],
      'login',
      ctx.em,
    )

    // Set refresh token jti to cookie
    this.authCookieService.setRTJtiCookie(req, refreshTokenJti)

    return new AuthSuccessDTO({ accessToken, sessionKey: authSessionKey })
  }
}

import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import {
  SysUserMfaWebauthnAuthenticateOptionsDTO,
  SysUserMfaWebauthnAuthenticateVerifyDTO,
  SysUserMfaWebauthnRegisterOptionsDTO,
  SysUserMfaWebauthnRegisterResponseDTO,
  SysUserMfaWebauthnRegisterVerifyDTO,
  SysUserMfaWebauthnService,
} from '@walnut-server/identity'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorJti, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardMFAFree } from '@/guard/mfa.guard'
import { AuthSuccessDTO } from '@/modules/auth/dto/auth.dto'
import { AuthCookieService } from '@/modules/auth/modules/cookie/cookie.service'

@Controller('system/user/mfa/webauthn')
@ApiTags('system/user/mfa/webauthn')
@WalnutAdminGuardMFAFree()
@WalnutAdminGuardLockFree()
export class SysUserMfaWebauthnController {
  constructor(
    private readonly userMfaWebauthnService: SysUserMfaWebauthnService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Post('register/options')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'generate WebAuthn registration options',
    DTO: SysUserMfaWebauthnRegisterResponseDTO,
  })
  async generateRegistrationOptions(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @Body() dto: SysUserMfaWebauthnRegisterOptionsDTO,
  ) {
    const res = await this.userMfaWebauthnService.generateRegistrationOptions(
      user.userId,
      deviceId,
      user.userName,
      dto.name,
    )
    return new SysUserMfaWebauthnRegisterResponseDTO(res)
  }

  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'verify and save WebAuthn registration',
    primitive: 'boolean',
  })
  async verifyAndSaveRegistration(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @Body() dto: SysUserMfaWebauthnRegisterVerifyDTO,
  ) {
    return this.userMfaWebauthnService.verifyAndSaveRegistration(
      user.userId,
      deviceId,
      dto.name,
      dto.response,
    )
  }

  @Post('authenticate/options')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'generate WebAuthn authentication options',
    DTO: SysUserMfaWebauthnAuthenticateOptionsDTO,
  })
  async generateAuthenticationOptions(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
  ) {
    const res = await this.userMfaWebauthnService.generateAuthenticationOptions(
      user.userId,
      deviceId,
    )
    return new SysUserMfaWebauthnAuthenticateOptionsDTO({ options: res })
  }

  @Post('authenticate/verify')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'verify WebAuthn authentication',
    DTO: AuthSuccessDTO,
  })
  async verifyAuthentication(
    @WalnutAdminDecoratorJti() jti: string,
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Req() req: IWalnutAdminExpressRequest,
    @Body() dto: SysUserMfaWebauthnAuthenticateVerifyDTO,
  ) {
    // B7b 归一：mfa 表写腿迁 PG —— 双句柄收成单 em
    // revoke-and-insert（2026-10-27）：verify 轮换 RT —— 新 jti 回种 cookie，
    // 否则客户端旧 jti 已撤销、下次 refresh 必 40102
    const { accessToken, jti: newJti } = await this.userMfaWebauthnService.verifyAuthentication(
      jti,
      deviceId,
      user,
      dto,
      ctx.em,
    )
    this.authCookieService.setRTJtiCookie(req, newJti)
    return new AuthSuccessDTO({ accessToken })
  }
}

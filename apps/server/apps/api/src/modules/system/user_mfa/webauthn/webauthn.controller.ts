import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutDBSession, WalnutDBTransaction, WalnutTxContext } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorJti, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardMFAFree } from '@/guard/mfa.guard'
import { AuthSuccessDTO } from '@/modules/auth/dto/auth.dto'
import {
  SysUserMfaWebauthnAuthenticateOptionsDTO,
  SysUserMfaWebauthnAuthenticateVerifyDTO,
  SysUserMfaWebauthnRegisterOptionsDTO,
  SysUserMfaWebauthnRegisterResponseDTO,
  SysUserMfaWebauthnRegisterVerifyDTO,
} from './webauthn.dto'
import { SysUserMfaWebauthnService } from './webauthn.service'

@Controller('system/user/mfa/webauthn')
@ApiTags('system/user/mfa/webauthn')
@WalnutAdminGuardMFAFree()
@WalnutAdminGuardLockFree()
export class SysUserMfaWebauthnController {
  constructor(
    private readonly userMfaWebauthnService: SysUserMfaWebauthnService,
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
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'verify WebAuthn authentication',
    DTO: AuthSuccessDTO,
  })
  async verifyAuthentication(
    @WalnutAdminDecoratorJti() jti: string,
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() ctx: WalnutTxContext,
    @Body() dto: SysUserMfaWebauthnAuthenticateVerifyDTO,
  ) {
    // B7a 跨引擎窗口双句柄：user 读腿（PG）走 ctx.em，mfa 表写腿（Mongo）走 ctx.dbSession —— 7b 归一
    const newAccessToken = await this.userMfaWebauthnService.verifyAuthentication(
      jti,
      deviceId,
      user,
      dto,
      ctx.em,
      ctx.dbSession!,
    )
    return new AuthSuccessDTO({ accessToken: newAccessToken })
  }
}

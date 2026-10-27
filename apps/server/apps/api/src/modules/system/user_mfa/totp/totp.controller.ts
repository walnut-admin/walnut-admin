import { Body, Controller, Delete, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutDBSession, WalnutDBTransaction, WalnutTxContext } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorJti, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardMFAFree } from '@/guard/mfa.guard'
import { AuthSuccessDTO } from '@/modules/auth/dto/auth.dto'
import { AuthCookieService } from '@/modules/auth/modules/cookie/cookie.service'
import { SysUserMfaBindTotpDTO, SysUserMfaBindTotpResponseDTO, SysUserMfaDeviceVerifyTotpDTO, SysUserMfaGenerateTotpResponseDTO, SysUserMfaUpdateStatusDTO } from './totp.dto'
import { SysUserMfaTotpService } from './totp.service'

// TODO fulfill
const PERMISSIONS_USER_MFA_TOTOP = {
  UPDATE_STATUS: 'system:user:mfa:totp:updateStatus',
  SHOW_QRCODE: 'system:user:mfa:totp:showQrcode',
  REBIND: 'system:user:mfa:totp:rebind',
  SHOW_BACKUP_CODES: 'system:user:mfa:totp:showBackupCodes',
} as const

@Controller('system/user/mfa/totp')
@ApiTags('system/user/mfa/totp')
@WalnutAdminGuardMFAFree()
@WalnutAdminGuardLockFree()
export class SysUserMfaTotpController {
  constructor(
    private readonly userMfaTotpService: SysUserMfaTotpService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'generate TOTP secret and QR code',
    DTO: SysUserMfaGenerateTotpResponseDTO,
  })
  async generateTotp(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() ctx: WalnutTxContext,
  ) {
    const res = await this.userMfaTotpService.generateTotp(user.userId, deviceId, ctx.em)
    return new SysUserMfaGenerateTotpResponseDTO(res)
  }

  @Post('bind')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'bind TOTP device',
    DTO: SysUserMfaBindTotpResponseDTO,
  })
  async bindTotp(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() ctx: WalnutTxContext,
    @Body() dto: SysUserMfaBindTotpDTO,
  ) {
    const res = await this.userMfaTotpService.bindTotp(user.userId, deviceId, dto, ctx.em)
    return new SysUserMfaBindTotpResponseDTO(res)
  }

  @Delete('unbind')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'unbind TOTP device',
    primitive: 'boolean',
  })
  async unbindDevice(@WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload, @WalnutDBSession() ctx: WalnutTxContext) {
    return this.userMfaTotpService.unbindTotp(user.userId, ctx.em)
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'verify TOTP',
    DTO: AuthSuccessDTO,
  })
  async verifyTotp(
    @WalnutAdminDecoratorJti() jti: string,
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutDBSession() ctx: WalnutTxContext,
    @Req() req: IWalnutAdminExpressRequest,
    @Body() dto: SysUserMfaDeviceVerifyTotpDTO,
  ) {
    // B7b 归一：mfa 表写腿迁 PG —— 双句柄收成单 em
    // revoke-and-insert（2026-10-27）：verify 轮换 RT —— 新 jti 回种 cookie，
    // 否则客户端旧 jti 已撤销、下次 refresh 必 40102
    const { accessToken, jti: newJti } = await this.userMfaTotpService.verifyTotp(jti, deviceId, user, dto, ctx.em)
    this.authCookieService.setRTJtiCookie(req, newJti)
    return new AuthSuccessDTO({ accessToken })
  }

  @Put('status')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(PERMISSIONS_USER_MFA_TOTOP.UPDATE_STATUS)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'update TOTP device status',
    primitive: 'boolean',
  })
  async updateStatus(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() ctx: WalnutTxContext,
    @Body() dto: SysUserMfaUpdateStatusDTO,
  ) {
    return this.userMfaTotpService.updateStatus(user.userId, dto.status, ctx.em)
  }
}

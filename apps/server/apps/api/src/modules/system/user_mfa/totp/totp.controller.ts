import { Body, Controller, Delete, HttpCode, HttpStatus, Post, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { ClientSession } from 'mongoose'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorJti, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardMFAFree } from '@/guard/mfa.guard'
import { AuthSuccessDTO } from '@/modules/auth/dto/auth.dto'
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
    @WalnutDBSession() dbSession: ClientSession,
  ) {
    const res = await this.userMfaTotpService.generateTotp(user.userId, deviceId, dbSession)
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
    @WalnutDBSession() dbSession: ClientSession,
    @Body() dto: SysUserMfaBindTotpDTO,
  ) {
    const res = await this.userMfaTotpService.bindTotp(user.userId, deviceId, dto, dbSession)
    return new SysUserMfaBindTotpResponseDTO(res)
  }

  @Delete('unbind')
  @HttpCode(HttpStatus.OK)
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'unbind TOTP device',
    primitive: 'boolean',
  })
  async unbindDevice(@WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload, @WalnutDBSession() dbSession: ClientSession) {
    return this.userMfaTotpService.unbindTotp(user.userId, dbSession)
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
    @WalnutDBSession() dbSession: ClientSession,
    @Body() dto: SysUserMfaDeviceVerifyTotpDTO,
  ) {
    const newAccessToken = await this.userMfaTotpService.verifyTotp(jti, deviceId, user, dto, dbSession)
    return new AuthSuccessDTO({ accessToken: newAccessToken })
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
    @WalnutDBSession() dbSession: ClientSession,
    @Body() dto: SysUserMfaUpdateStatusDTO,
  ) {
    return this.userMfaTotpService.updateStatus(user.userId, dto.status, dbSession)
  }
}

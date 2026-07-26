import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardDeviceFree } from '@/guard/device.guard'
import { WalnutAdminGuardIpFree } from '@/guard/ip.guard'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardMFAFree } from '@/guard/mfa.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { WalnutAdminGuardJwtOptional } from '@/modules/auth/modules/jwt/jwt-access.guard'
import { SysUserPreferenceDTOAccessibilityRequest, SysUserPreferenceDTOBasicRequest, SysUserPreferenceDTOLayoutRequest, SysUserPreferenceDTOThemeRequest, SysUserPreferenceResponseDTO } from '../dto/user_preference.dto'
import { SysUserPreferenceService } from '../services/user_preference.service'

const Permissions = {
  UPDATE_BASIC: 'system:user:preference:updateBasic',
  UPDATE_ACCESSIBILITY: 'system:user:preference:updateAccessibility',
  UPDATE_THEME: 'system:user:preference:updateTheme',
  UPDATE_LAYOUT: 'system:user:preference:updateLayout',
} as const

@Controller('system/user/preference')
@ApiTags('system/user/preference')
export class SysUserPreferenceController {
  constructor(
    private readonly preferenceService: SysUserPreferenceService,
  ) {}

  @Get('read')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardJwtOptional()
  @WalnutAdminGuardLockFree()
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardMFAFree()
  @WalnutAdminGuardDeviceFree()
  @WalnutAdminGuardIpFree()
  @ApiWalnutOkResponse({
    description: 'Get current user preference',
    DTO: SysUserPreferenceResponseDTO,
  })
  async get(@WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload) {
    const res = await this.preferenceService.getPreferenceForUser(user?.userId)
    return new SysUserPreferenceResponseDTO(res)
  }

  @Patch('basic')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE_BASIC)
  @ApiWalnutOkResponse({
    description: 'Update current user basic preference',
    primitive: 'boolean',
  })
  async basic(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Body() payload: SysUserPreferenceDTOBasicRequest,
  ) {
    return this.preferenceService.updateBasic(user.userId, payload)
  }

  @Patch('accessibility')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE_ACCESSIBILITY)
  @ApiWalnutOkResponse({
    description: 'Update current user accessibility preference',
    primitive: 'boolean',
  })
  async accessibility(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Body() payload: SysUserPreferenceDTOAccessibilityRequest,
  ) {
    return this.preferenceService.updateAccessibility(user.userId, payload)
  }

  @Patch('theme')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE_THEME)
  @ApiWalnutOkResponse({
    description: 'Update current user theme preference',
    primitive: 'boolean',
  })
  async theme(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Body() payload: SysUserPreferenceDTOThemeRequest,
  ) {
    return this.preferenceService.updateTheme(user.userId, payload)
  }

  @Patch('layout')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE_LAYOUT)
  @ApiWalnutOkResponse({
    description: 'Update current user layout preference',
    primitive: 'boolean',
  })
  async layout(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Body() payload: SysUserPreferenceDTOLayoutRequest,
  ) {
    return this.preferenceService.updateLayout(user.userId, payload)
  }
}

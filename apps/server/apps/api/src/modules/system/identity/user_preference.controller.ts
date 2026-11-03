import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { WalnutAdminGuardJwtOptional } from '@walnut-server/auth'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorUser, WalnutAdminGuardDeviceFree, WalnutAdminGuardLockFree, WalnutAdminGuardMFAFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { SysUserPreferenceDTOAccessibilityRequest, SysUserPreferenceDTOBasicRequest, SysUserPreferenceDTOLayoutRequest, SysUserPreferenceDTOThemeRequest, SysUserPreferenceResponseDTO, SysUserPreferenceService } from '@walnut-server/identity'
import { SystemEndpointRoutes } from '@walnut/contract'

const Permissions = {
  UPDATE_BASIC: 'system:user:preference:updateBasic',
  UPDATE_ACCESSIBILITY: 'system:user:preference:updateAccessibility',
  UPDATE_THEME: 'system:user:preference:updateTheme',
  UPDATE_LAYOUT: 'system:user:preference:updateLayout',
} as const

@Controller(SystemEndpointRoutes.USER_PREFERENCE)
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
  // 批次 8 / B3（2026-11）：撤掉 @WalnutAdminGuardIpFree() —— JwtOptional 只影响
  // 「谁的身份」，不影响「这个 IP 还能不能来」；被拉黑 IP 拿到的偏好默认值没有价值。
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

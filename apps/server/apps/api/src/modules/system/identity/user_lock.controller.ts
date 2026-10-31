import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Request } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { SysUserLockDoLockDto, SysUserLockPreferenceDTO, SysUserLockPreferenceUpdateDto, SysUserLockService, SysUserLockUnLockDto } from '@walnut-server/identity'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'

@Controller('system/user/lock')
@ApiTags('system/user/lock')
export class SysUserLockController {
  constructor(
    private readonly lockService: SysUserLockService,
  ) {}

  @Get('read')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  // OpenAPI codegen 二期（2026-10-28）：原 `primitive: 'boolean'` 与真实返回（对象）
  // 不符，admin 的锁屏状态类型无法从生成类型推导 —— 装饰器改为真实 DTO（wire 零变化）
  @ApiWalnutOkResponse({
    description: 'Get current user lock status',
    DTO: SysUserLockPreferenceDTO,
  })
  async get(@WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload, @WalnutAdminDecoratorDeviceId() deviceId: string) {
    const res = await this.lockService.getLockStatusForUser(user?.userId, deviceId)
    return new SysUserLockPreferenceDTO(res)
  }

  /**
   * P2-26（2026-10-29）：锁屏偏好写入通道 —— `lockMode` / `lockIdleSec` /
   * `lockSecuritySec` / `lockCrossDevice` / `lockPwdHash`（明文，仓库侧 bcrypt）。
   *
   * 刻意**不挂 LockFree**（与 lock/unlock 的形态差异，报告已说明）：偏好是登录态下的
   * 设置项，锁定期间不允许通过本端点关掉 security 模式绕过锁屏密码 —— LockFree 会
   * 把「锁定 → 改偏好」变成免密旁路。
   */
  @Patch('preference')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Update current user lock preference',
    primitive: 'boolean',
  })
  async updatePreference(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() payload: SysUserLockPreferenceUpdateDto,
  ) {
    return this.lockService.updatePreference(user.userId, payload, ctx.em)
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Lock current user account',
    primitive: 'boolean',
  })
  async lock(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Request() req: IWalnutAdminExpressRequest,
    @Body() payload: SysUserLockDoLockDto,
  ) {
    return this.lockService.lock(user.userId, deviceId, req.fingerprint, payload, ctx.em)
  }

  @Patch('unlock')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Unlock current user account',
    primitive: 'boolean',
  })
  async unlock(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Request() req: IWalnutAdminExpressRequest,
    @Body() payload: SysUserLockUnLockDto,
  ) {
    return this.lockService.unlock(user.userId, deviceId, req.fingerprint, payload, ctx.em)
  }
}

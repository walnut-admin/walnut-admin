import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Request } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { AuthOpaqueCoreService } from '@walnut-server/auth'
import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminExceptionInvalidCredential } from '@walnut-server/exceptions/business/auth'

import { WalnutAdminDecoratorDecryptRequest, WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorUser, WalnutAdminGuardLockFree } from '@walnut-server/guards'
import { SysUserLockDoLockDto, SysUserLockPreferenceDTO, SysUserLockPreferenceUpdateDto, SysUserLockService, SysUserLockUnLockDto, SysUserLockVerifyFinishDto, SysUserLockVerifyStartDto } from '@walnut-server/identity'
import { WalnutAdminPipeUuid } from '@walnut-server/pipes'
import { SystemEndpointRoutes } from '@walnut/contract'
import { WalnutAdminDecoratorOperateLog } from '@/decorators/walnut/log.operate.decorator'

const Permissions = {
  // Q6（2026-11-27）：管理员重置某用户的锁屏（只解锁 + 清计次，不读不碰 hash）
  RESET: 'system:user:lock:reset',
} as const

@Controller(SystemEndpointRoutes.USER_LOCK)
@ApiTags('system/user/lock')
export class SysUserLockController {
  constructor(
    private readonly lockService: SysUserLockService,
    private readonly authOpaqueCoreService: AuthOpaqueCoreService,
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
   *
   * Q10（2026-11-27）：锁屏密码是本仓第一个消费**请求加密信封**的字段 ——
   * `_autoEncryptRequestData`（admin）加密后 `lockPwdHash` 是 base64 信封串，服务端
   * `@WalnutAdminDecoratorDecryptRequest` 用 RSA 私钥 + AES-GCM 还原后再进 DTO 校验与
   * bcrypt。明文字段（未启用信封的客户端 / 存量用例）原样透传，见拦截器注释。
   */
  @Patch('preference')
  @HttpCode(HttpStatus.OK)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Update current user lock preference',
    primitive: 'boolean',
  })
  @WalnutAdminDecoratorDecryptRequest(['lockPwdHash'] as const)
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
  @WalnutAdminDecoratorDecryptRequest(['lockPwdHash'] as const)
  async unlock(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Request() req: IWalnutAdminExpressRequest,
    @Body() payload: SysUserLockUnLockDto,
  ) {
    return this.lockService.unlock(user.userId, deviceId, req.fingerprint, payload, ctx.em)
  }

  /**
   * 方案①（Q8：`/system/user/lock/verify/*`）：忘记锁屏密码 → 用登录口令（OPAQUE）验证。
   *
   * 守卫组合（与设计稿 §6.6 的矩阵一致）：
   * - **LockFree**：锁定期间可达（这是本方案唯一新增的权限面，所以必须配计次/退避）；
   * - **不 MFAFree**：与登录同等级 —— 用户若开了 MFA，先过 MFA 再走本端点（MFA 端点本身
   *   LockFree+MFAFree，`mfa.guard` 在 lock.guard 之前）。
   *
   * 密码永不离开客户端：`start` 只是 OPAQUE 的第一次握手，服务端只落 30s 的
   * SERVER_STATE（`unlock` 命名空间，与登录流隔离）。
   */
  @Post('verify/start')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Start login-password verification for unlocking (OPAQUE step 1/2, no token issued)',
    primitive: 'string',
  })
  async verifyStart(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() dto: SysUserLockVerifyStartDto,
  ) {
    // 退避期内连 start 也不给（省 OPAQUE 计算，语义：先等倒计时）
    await this.lockService.assertUnlockBackoffForUser(user.userId, ctx.em)

    return this.authOpaqueCoreService.startLogin(user.userName, dto.start, deviceId, ctx.em, 'unlock')
  }

  /**
   * verify 第 2 步：验证通过**就地解锁**，不签发 token、不新建会话。
   *
   * 失败一律 40103（与登录同码）+ `meta.failCount` / `meta.retryAfterSec`（进入退避时）；
   * 计数与锁屏密码解锁共用一套预算（Q7：防止挑弱通道打）。
   */
  @Post('verify/finish')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Finish login-password verification and unlock in place (no token issued)',
    primitive: 'boolean',
  })
  async verifyFinish(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Request() req: IWalnutAdminExpressRequest,
    @Body() dto: SysUserLockVerifyFinishDto,
  ) {
    await this.lockService.assertUnlockBackoffForUser(user.userId, ctx.em)

    let verified: { userId: string }

    try {
      verified = await this.authOpaqueCoreService.verifyLoginForUnlock(user.userName, dto.finish, deviceId, ctx.em, 'unlock')
    }
    catch (error) {
      // 计次落在独立事务（请求事务随异常回滚），见 SysUserLockRepositoryService.recordUnlockFailure
      const { failCount, retryAfterSec } = await this.lockService.recordFallbackVerifyFailure(user.userId)

      if (error instanceof WalnutAdminExceptionInvalidCredential) {
        throw new WalnutAdminExceptionInvalidCredential({
          meta: {
            failCount,
            ...(retryAfterSec > 0 ? { retryAfterSec } : {}),
          },
        })
      }

      throw error
    }

    // 防「用 A 的登录口令解 B 的锁」：验证得到的身份必须与 AT 身份一致
    if (verified.userId !== user.userId) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    return this.lockService.unlockAfterCredentialVerified(user.userId, deviceId, req.fingerprint, ctx.em)
  }

  /**
   * Q6（2026-11-27）：管理员重置某用户的锁屏 —— 兜底也失效时的最后一道运维通道。
   *
   * - 权限 `system:user:lock:reset`（root 短路放行，其余角色需显式授予）；
   * - **只解锁 + 清计次**：清该用户全部 `sys_user_device.locked`、清失败计数、清锁缓存、
   *   广播 UNLOCK —— **不读不碰 `lock_pwd_hash`**（管理员既拿不到也改不了用户的锁屏密码）；
   * - 审计落在 `sys_log_operate`（operateType `user.lock.reset`）。
   */
  @Put('reset/:userId')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.RESET)
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Reset (unlock) the lock screen state of a user, without reading or changing the lock password',
    primitive: 'boolean',
  })
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.UNLOCK,
    action: WalnutAdminConstDecoratorLogOperateAction.UPDATE,
    operateType: WalnutAdminConstDecoratorLogOperateType.USER_LOCK_RESET,
  })
  async resetUserLock(
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('userId', new WalnutAdminPipeUuid()) userId: string,
  ) {
    return this.lockService.resetUserLockByAdmin(userId, ctx.em)
  }
}

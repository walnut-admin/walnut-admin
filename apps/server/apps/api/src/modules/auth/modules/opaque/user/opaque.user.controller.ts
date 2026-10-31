import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Req, Request, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { IWalnutAdminConstAppSettingAuthOpaqueKeys } from '@walnut-server/const/app/setting'
import { WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminExceptionInvalidCredential } from '@walnut-server/exceptions/business/auth'

import { SysLogAuthSharedService } from '@walnut-server/system'
import { WalnutAdminDecoratorDataScopeSystemChannel } from '@/decorators/walnut/dataScope.decorator'
import { WalnutAdminDecoratorFunctionalGuard } from '@/decorators/walnut/functional.decorator'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorAuthLog } from '@/decorators/walnut/log.auth.decorator'
import { WalnutAdminDecoratorOperateLog } from '@/decorators/walnut/log.operate.decorator'
import { WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { AuthSuccessDTO } from '../../../dto/auth.dto'
import { AuthCookieService } from '../../cookie/cookie.service'
import { WalnutAdminGuardJwtFree } from '../../jwt/jwt-access.guard'
import { AuthSignoutService } from '../../signout/signout.service'
import { AuthOpaqueCoreService } from '../core/opaque.core.service'
import { AuthOpaqueClientErrorDTO, AuthOpaqueFinishChangePasswordDTO, AuthOpaqueFinishSignInDTO, AuthOpaqueFinishSignUpDTO, AuthOpaqueStartChangePasswordDTO, AuthOpaqueStartSignInDTO, AuthOpaqueStartSignUpDTO } from '../dto/opaque.dto'
import { AuthOpaqueUserGuard } from './opaque.user.guard'

const WalnutAdminConstPermissionOpaque = {
  CHANGE_PASSWORD: 'me:auth:opaque:changePassword',
} as const

@Controller('auth/opaque/user')
@ApiTags('auth/opaque/user')
export class AuthOpaqueUserController {
  private readonly logger = new Logger(AuthOpaqueUserController.name)

  constructor(
    private readonly authCookieService: AuthCookieService,
    private readonly authOpaqueCoreService: AuthOpaqueCoreService,
    private readonly signoutService: AuthSignoutService,
    private readonly logAuthSharedService: SysLogAuthSharedService,
  ) { }

  @Post('login/start')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorFunctionalGuard<IWalnutAdminConstAppSettingAuthOpaqueKeys>(WalnutAdminConstAppSettingKeys.APP_AUTH_OPAQUE, 'authEnable')
  @WalnutAdminGuardJwtFree()
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Start login with userName and loginRequest',
    primitive: 'string',
  })
  @WalnutAdminDecoratorDataScopeSystemChannel()
  async startLogin(
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Req() req: IWalnutAdminExpressRequest,
    @Body() dto: AuthOpaqueStartSignInDTO,
  ) {
    try {
      // B7a 签名适配：user/identity 读腿迁 PG —— 传 ctx.em
      return await this.authOpaqueCoreService.startLogin(dto.userName, dto.start, deviceId, ctx.em)
    }
    catch (error) {
      // Record failed auth log and risk
      await this.logAuthSharedService.recordAuth({
        request: req,
        authType: WalnutAdminConstDecoratorLogAuthType.OPAQUE,
        identifier: dto.userName,
        deviceId,
        success: false,
        errI18nMsg: 'response.40103',
      })
      throw error
    }
  }

  @Post('login/client-error')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardJwtFree()
  @ApiWalnutOkResponse({
    description: 'Report client-side OPAQUE error',
    primitive: 'boolean',
  })
  async reportClientError(
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @Req() req: IWalnutAdminExpressRequest,
    @Body() dto: AuthOpaqueClientErrorDTO,
  ) {
    await this.logAuthSharedService.recordAuth({
      request: req,
      authType: WalnutAdminConstDecoratorLogAuthType.OPAQUE,
      identifier: dto.userName,
      deviceId,
      success: false,
      errI18nMsg: `business.auth.opaque.${dto.clientError}`,
    })

    // Extra warning for potential MITM attack
    if (dto.clientError === 'serverStaticKeyMismatch') {
      this.logger.warn(`Possible MITM attack detected for user: ${dto.userName}, IP: ${req.realIp}`)
    }

    throw new WalnutAdminExceptionInvalidCredential()
  }

  @Post('login/finish')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorFunctionalGuard<IWalnutAdminConstAppSettingAuthOpaqueKeys>(WalnutAdminConstAppSettingKeys.APP_AUTH_OPAQUE, 'authEnable')
  @WalnutAdminGuardJwtFree()
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Finish login with userName and finish',
    DTO: AuthSuccessDTO,
  })
  @WalnutAdminDecoratorAuthLog(WalnutAdminConstDecoratorLogAuthType.OPAQUE)
  @UseGuards(AuthOpaqueUserGuard)
  @WalnutAdminDecoratorDataScopeSystemChannel()
  async finishLogin(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Request() req: IWalnutAdminExpressRequest,
    @Body() _dto: AuthOpaqueFinishSignInDTO,
  ) {
    // B7b 归一：refresh 写腿迁 PG —— 单 em
    const { accessToken, refreshTokenJti, authSessionKey } = await this.authOpaqueCoreService.finishLogin(user, deviceId, ctx.em)

    // set refresh token jti to cookie
    this.authCookieService.setRTJtiCookie(req, refreshTokenJti)

    return new AuthSuccessDTO({ accessToken, sessionKey: authSessionKey })
  }

  @Post('register/start')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorFunctionalGuard<IWalnutAdminConstAppSettingAuthOpaqueKeys>(WalnutAdminConstAppSettingKeys.APP_AUTH_OPAQUE, 'register')
  // P1-3 修复（2026-10-28）：register 端点的语义是「已登录用户补挂口令」（handler 读
  // req.user.userName）。原先挂 JwtFree 让匿名调用解引用 req.user → 未受控 50000；
  // 摘掉 JwtFree 后由全局 JWT 生效：未登录 40101 受控拒绝，登录态行为不变。
  // P1-14（2026-10-28）：服务层改为按 req.user.userId upsert password identity ——
  // 不再按 userName 查重抛 DataExists（登录态 userName 必然存在 → 旧实现恒 40001）。
  @ApiWalnutOkResponse({
    description: 'Start register with userName and registrationRequest',
    primitive: 'string',
  })
  async startRegister(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Body() dto: AuthOpaqueStartSignUpDTO,
  ) {
    return this.authOpaqueCoreService.startRegister(user.userName, dto.start)
  }

  @Post('register/finish')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorFunctionalGuard<IWalnutAdminConstAppSettingAuthOpaqueKeys>(WalnutAdminConstAppSettingKeys.APP_AUTH_OPAQUE, 'register')
  // P1-3：同 register/start —— 登录态路由（未登录由全局 JWT 层 40101）
  // P1-14：finish 按 user.userId 补挂/替换 password identity（不建用户、不查重）
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Finish register with userName and registrationFinish',
    primitive: 'boolean',
  })
  async finishRegister(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() dto: AuthOpaqueFinishSignUpDTO,
  ) {
    // B7a 签名适配：user/identity 写腿迁 PG —— 传 ctx.em（该端点本就挂了
    // @WalnutTx，接线后注册两腿获得事务原子性）
    return this.authOpaqueCoreService.finishRegister(
      user.userId,
      dto.finish,
      ctx.em,
    )
  }

  @Post('change-password/start')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(
    WalnutAdminConstPermissionOpaque.CHANGE_PASSWORD,
  )
  @WalnutAdminDecoratorFunctionalGuard<IWalnutAdminConstAppSettingAuthOpaqueKeys>(WalnutAdminConstAppSettingKeys.APP_AUTH_OPAQUE, 'change')
  @ApiWalnutOkResponse({
    description: 'Start password change with registration request',
    primitive: 'string',
  })
  async changePasswordStart(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @Body() dto: AuthOpaqueStartChangePasswordDTO,
  ) {
    return this.authOpaqueCoreService.startChangePassword(user.userName, dto.start)
  }

  @Post('change-password/finish')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(
    WalnutAdminConstPermissionOpaque.CHANGE_PASSWORD,
  )
  @WalnutAdminDecoratorFunctionalGuard<IWalnutAdminConstAppSettingAuthOpaqueKeys>(WalnutAdminConstAppSettingKeys.APP_AUTH_OPAQUE, 'change')
  @WalnutTx()
  @ApiWalnutOkResponse({
    description: 'Finish password change with new registration record',
    primitive: 'boolean',
  })
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.AUTH_OPAQUE,
    action: WalnutAdminConstDecoratorLogOperateAction.AUTH,
    operateType: WalnutAdminConstDecoratorLogOperateType.AUTH_OPAQUE_CHANGE_PASSWORD,
  })
  async changePasswordFinish(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() dto: AuthOpaqueFinishChangePasswordDTO,
  ) {
    // B7b 归一：signout 的 refresh 写腿迁 PG —— 单 em
    await this.signoutService.doSignout(user.userId, { trigger: 'security-policy', revokeReason: 'updatePass' }, ctx.em)

    return this.authOpaqueCoreService.finishChangePassword(
      user.userName,
      dto.finish,
      ctx.em,
    )
  }
}

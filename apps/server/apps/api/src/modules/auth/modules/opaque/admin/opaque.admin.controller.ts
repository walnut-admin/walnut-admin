import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import { WalnutDBSession, WalnutDBTransaction, WalnutTxContext } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorOperateLog } from '@/decorators/walnut/log.operate.decorator'
import { AuthOpaqueClearPasswordForAdminDTO, AuthOpaqueFinishChangePasswordForAdminDTO, AuthOpaqueStartChangePasswordForAdminDTO } from '../dto/opaque.dto'
import { AuthOpaqueAdminService } from './opaque.admin.service'

const WalnutAdminConstPermissionOpaqueAdmin = {
  PASSWORD_UPDATE: 'system:user:pass:update',
  PASSWORD_CLEAR: 'system:user:pass:clear',
} as const

@Controller('auth/opaque/admin')
@ApiTags('auth/opaque/admin')
export class AuthOpaqueAdminController {
  constructor(
    private readonly authOpaqueAdminService: AuthOpaqueAdminService,
  ) { }

  @Post('password/update/start')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(
    WalnutAdminConstPermissionOpaqueAdmin.PASSWORD_UPDATE,
  )
  @ApiWalnutOkResponse({
    description: 'Start password change with registration request',
    primitive: 'string',
  })
  async changePasswordStart(
    @Body() dto: AuthOpaqueStartChangePasswordForAdminDTO,
  ) {
    return this.authOpaqueAdminService.startChangePassword(dto)
  }

  @Post('password/update/finish')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(
    WalnutAdminConstPermissionOpaqueAdmin.PASSWORD_UPDATE,
  )
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Finish password change with new registration record',
    primitive: 'boolean',
  })
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.AUTH_OPAQUE,
    action: WalnutAdminConstDecoratorLogOperateAction.AUTH,
    operateType: WalnutAdminConstDecoratorLogOperateType.USER_UPDATE_PASSWORD,
  })
  async changePasswordFinish(
    @WalnutDBSession() ctx: WalnutTxContext,
    @Body() dto: AuthOpaqueFinishChangePasswordForAdminDTO,
  ) {
    // B7b 归一：signout 的 refresh 写腿迁 PG —— 单 em
    return this.authOpaqueAdminService.finishChangePassword(dto, ctx.em)
  }

  @Post('password/clear')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(
    WalnutAdminConstPermissionOpaqueAdmin.PASSWORD_CLEAR,
  )
  @WalnutDBTransaction()
  @ApiWalnutOkResponse({
    description: 'Clear password for user',
    primitive: 'boolean',
  })
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.AUTH_OPAQUE,
    action: WalnutAdminConstDecoratorLogOperateAction.AUTH,
    operateType: WalnutAdminConstDecoratorLogOperateType.USER_CLEAR_PASSWORD,
  })
  async clearPasswordFinish(
    @WalnutDBSession() ctx: WalnutTxContext,
    @Body() dto: AuthOpaqueClearPasswordForAdminDTO,
  ) {
    // B7a 签名适配：identity 腿迁 PG —— 传 ctx.em
    return this.authOpaqueAdminService.clearPassword(dto.id, ctx.em)
  }
}

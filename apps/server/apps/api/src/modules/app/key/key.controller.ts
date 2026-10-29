import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, SetMetadata, UseGuards } from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorPermissionMetadataKey } from '@walnut-server/const/decorator/permissions'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminPipeParamEnum } from '@walnut-server/pipes'
import { Role } from '@walnut/contract'
import { plainToInstance } from 'class-transformer'

import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { AppKeyCurrentResponseDTO, AppKeyDTOInit, AppKeyDTOSafe } from './dto/key.dto'
import { AppKeyTypeConst, AppKeyTypeConstType } from './key.const'
import { AppKeyCurrentGuard } from './key.current.guard'
import { AppKeyService } from './key.service'

/** P0-6：key 管理面读权限点（root 短路；只在 RSA_PAIR 视图上生效，见 AppKeyCurrentGuard） */
const Permissions = {
  READ: 'app:key:read',
} as const

/**
 * B4 迁移（controller 层，模板同 demo）：事务句柄 `ctx.dbSession` → `ctx.em`；
 * 响应组装 `.toObject()` 移除（PG 实体即 POJO），统一 plainToInstance(DTO, entity)。
 */
@Controller('app/key')
@ApiTags('app/key')
export class AppKeyController {
  constructor(private readonly appKeyService: AppKeyService) {}

  @Get('current/:type')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'type', description: 'key type enum', enum: AppKeyTypeConst })
  @ApiWalnutOkResponse({
    description: 'get current app key public face (publicKeyPem for RSA_PAIR / keyB64 for AES_KEY_URL)',
    DTO: AppKeyCurrentResponseDTO,
  })
  @UseGuards(AppKeyCurrentGuard)
  @SetMetadata(WalnutAdminConstDecoratorPermissionMetadataKey.PERMISSION, Permissions.READ)
  async getCurrent(
    @Param('type', new WalnutAdminPipeParamEnum(AppKeyTypeConst))
    type: AppKeyTypeConstType,
  ) {
    return this.appKeyService.getCurrent(type)
  }

  @Post('init')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasRole(Role.ROOT)
  async init(@Body() dto: AppKeyDTOInit) {
    const { type } = dto
    return plainToInstance(AppKeyDTOSafe, await this.appKeyService.initFirst(type))
  }

  @Post('rotate/:type')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasRole(Role.ROOT)
  @WalnutTx()
  @ApiParam({ name: 'type', description: 'key type enum', enum: AppKeyTypeConst })
  async rotate(
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('type', new WalnutAdminPipeParamEnum(AppKeyTypeConst))
    type: AppKeyTypeConstType,
  ) {
    return plainToInstance(AppKeyDTOSafe, await this.appKeyService.rotate(type, ctx.em))
  }
}

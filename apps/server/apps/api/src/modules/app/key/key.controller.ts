import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'
import { WalnutDBSession, WalnutDBTransaction, WalnutTxContext } from '@walnut-server/db'
import { WalnutAdminPipeParamEnum } from '@walnut-server/pipes'
import { Role } from '@walnut/contract'
import { plainToInstance } from 'class-transformer'

import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { AppKeyDTOInit, AppKeyDTOSafe } from './dto/key.dto'
import { AppKeyTypeConst, AppKeyTypeConstType } from './key.const'
import { AppKeyService } from './key.service'

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
  @WalnutDBTransaction()
  @ApiParam({ name: 'type', description: 'key type enum', enum: AppKeyTypeConst })
  async rotate(
    @WalnutDBSession() ctx: WalnutTxContext,
    @Param('type', new WalnutAdminPipeParamEnum(AppKeyTypeConst))
    type: AppKeyTypeConstType,
  ) {
    return plainToInstance(AppKeyDTOSafe, await this.appKeyService.rotate(type, ctx.em))
  }
}

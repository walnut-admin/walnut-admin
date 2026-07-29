import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import { WalnutAdminPipeParamEnum } from '@walnut-server/pipes'
import { Role } from '@walnut/contract'
import { ClientSession } from 'mongoose'
import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { AppKeyDTOInit, AppKeyDTOSafe } from './dto/key.dto'
import { AppKeyService } from './key.service'
import { AppKeyTypeConst, AppKeyTypeConstType } from './schema/key.schema'

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
    return new AppKeyDTOSafe((await this.appKeyService.initFirst(type))!.toObject())
  }

  @Post('rotate/:type')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasRole(Role.ROOT)
  @WalnutDBTransaction()
  @ApiParam({ name: 'type', description: 'key type enum', enum: AppKeyTypeConst })
  async rotate(
    @WalnutDBSession() session: ClientSession,
    @Param('type', new WalnutAdminPipeParamEnum(AppKeyTypeConst))
    type: AppKeyTypeConstType,
  ) {
    return new AppKeyDTOSafe((await this.appKeyService.rotate(type, session))!.toObject())
  }
}

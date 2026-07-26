import { Body, Controller, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut/const/decorator/logOperate'

import { WalnutDBSession, WalnutDBTransaction } from '@walnut/db'

import {
  WalnutAdminDecoratorParamMongoId,
  WalnutAdminDecoratorParamMongoIds,
} from '@walnut/decorators/params'

import { ClientSession } from 'mongoose'
import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { JwtAccessGuard } from '@/modules/auth/modules/jwt/jwt-access.guard'
import {
  SysLogAuthDTO,
  SysLogAuthDTODeleteResponse,
  SysLogAuthDTOListRequest,
  SysLogAuthDTOListResponse,
} from './dto/log.auth.dto'
import { SysLogAuthService } from './log.auth.service'

const Permissions = {
  DELETE: 'system:log:auth:delete',
  DELETE_MANY: 'system:log:auth:deleteMany',
  LIST: 'system:log:auth:list',
} as const

const { WalnutAdminDecoratorDelete, WalnutAdminDecoratorDeleteMany, WalnutAdminDecoratorList }
  = WalnutCrudDecorators({
    title: WalnutAdminConstDecoratorLogOperateTitle.LOG_AUTH,
    DTO: SysLogAuthDTO,
  })

@Controller('system/log/auth')
@ApiTags('system/log/auth')
@UseGuards(JwtAccessGuard)
export class SysLogAuthController {
  constructor(private readonly logAuthService: SysLogAuthService) {}

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete()
  @WalnutDBTransaction()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() session: ClientSession,
    @WalnutAdminDecoratorParamMongoId() id: string,
  ) {
    return new SysLogAuthDTODeleteResponse(
      (await this.logAuthService.delete(id, user.userId, session)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE_MANY)
  @WalnutAdminDecoratorDeleteMany()
  @WalnutDBTransaction()
  async deleteMany(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() session: ClientSession,
    @WalnutAdminDecoratorParamMongoIds() ids: string[],
  ) {
    const deleted = await this.logAuthService.deleteMany(ids, user.userId, session)

    return deleted.map(i => new SysLogAuthDTODeleteResponse(i.toObject()))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysLogAuthDTOListRequest) {
    return new SysLogAuthDTOListResponse(
      await this.logAuthService.list(payload),
    )
  }
}

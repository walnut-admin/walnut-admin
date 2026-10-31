import { Body, Controller, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'

import { WalnutCrudDecorators } from '@walnut-server/crud'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import {
  WalnutAdminDecoratorParamUuid,
  WalnutAdminDecoratorParamUuids,
} from '@walnut-server/decorators/params'

import { plainToInstance } from 'class-transformer'
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

/**
 * B8 迁移（controller 层，B1 模板）：路由参数 ParamMongoId(s) → uuid 参数装饰器；
 * 事务句柄 `ctx.dbSession` → `ctx.em`（PG 单引擎，B7b 归一口径）；`.toObject()` 移除，
 * 响应组装统一 `plainToInstance(DTO, entity)`。
 */
@Controller('system/log/auth')
@ApiTags('system/log/auth')
@UseGuards(JwtAccessGuard)
export class SysLogAuthController {
  constructor(private readonly logAuthService: SysLogAuthService) {}

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete()
  @WalnutTx()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(
      SysLogAuthDTODeleteResponse,
      await this.logAuthService.delete(id, user.userId, ctx.em),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE_MANY)
  @WalnutAdminDecoratorDeleteMany()
  @WalnutTx()
  async deleteMany(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuids() ids: string[],
  ) {
    const deleted = await this.logAuthService.deleteMany(ids, user.userId, ctx.em)

    return deleted.map(i => plainToInstance(SysLogAuthDTODeleteResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysLogAuthDTOListRequest) {
    return plainToInstance(
      SysLogAuthDTOListResponse,
      await this.logAuthService.list(payload),
    )
  }
}

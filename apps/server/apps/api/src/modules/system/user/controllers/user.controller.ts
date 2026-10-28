import {
  Body,
  Controller,

} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { plainToInstance } from 'class-transformer'

import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import {
  SysUserDTOCreateRequest,
  SysUserDTOCreateResponse,
  SysUserDTODeleteResponse,
  SysUserDTOListRequest,
  SysUserDTOListResponse,
  SysUserDTOReadResponse,
  SysUserDTOSafe,
  SysUserDTOUpdateRequest,
  SysUserDTOUpdateResponse,
} from '../dto/user.dto'
import { SysUserCrudService } from '../services/user.crud.service'

const Permissions = {
  CREATE: 'system:user:create',
  READ: 'system:user:read',
  UPDATE: 'system:user:update',
  DELETE: 'system:user:delete',
  DELETE_MANY: 'system:user:deleteMany',
  LIST: 'system:user:list',
  PASSWORD_UPDATE: 'system:user:pass:update',
  PASSWORD_RESET: 'system:user:pass:reset',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.USER,
  DTO: SysUserDTOSafe,
})

/**
 * B7a 迁移（controller 层，B1 模板）：ParamMongoId → uuid 参数装饰器；事务句柄
 * `ctx.dbSession` → `ctx.em`（WalnutTxContext 双引擎上下文，已迁侧取 em）；
 * 响应组装 `.toObject()` 移除（PG 实体即 POJO），统一 plainToInstance(DTO, entity)。
 */
@Controller('system/user')
@ApiTags('system/user')
export class SysUserController {
  constructor(
    private readonly userCrudService: SysUserCrudService,
  ) { }

  @WalnutAdminDecoratorHasPermission(
    Permissions.CREATE,
  )
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysUserDTOCreateRequest) {
    return plainToInstance(SysUserDTOCreateResponse, await this.userCrudService.create(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysUserDTOReadResponse, await this.userCrudService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(
    Permissions.UPDATE,
  )
  @WalnutAdminDecoratorUpdate()
  async update(
    @Body() payload: SysUserDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(SysUserDTOUpdateResponse, await this.userCrudService.update(id, payload))
  }

  @WalnutAdminDecoratorHasPermission(
    Permissions.DELETE,
  )
  @WalnutAdminDecoratorDelete()
  @WalnutTx()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(
      SysUserDTODeleteResponse,
      await this.userCrudService.delete(id, user.userId, ctx.em),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysUserDTOListRequest) {
    return plainToInstance(SysUserDTOListResponse, await this.userCrudService.list(payload))
  }
}

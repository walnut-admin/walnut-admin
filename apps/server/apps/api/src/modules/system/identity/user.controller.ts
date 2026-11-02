import {
  Body,
  Controller,

} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'

import { WalnutCrudDecorators } from '@walnut-server/crud'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'

import { WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorUser } from '@walnut-server/guards'
import { SysUserCrudService } from '@walnut-server/identity'
import { SystemRoutes } from '@walnut/contract'
import { plainToInstance } from 'class-transformer'
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
} from '@/modules/system/user/dto/user.dto'

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
 *
 * P1-19（2026-10-28）：create / update 补 @WalnutTx —— 主行 + sys_user_role junction
 * 两腿必须原子（此前 junction 失败会留下「主行已提交、无角色绑定」的脏用户，
 * update 同理可半成功）。对照 role.controller 的写路径形态。
 */
@Controller(SystemRoutes.USER)
@ApiTags('system/user')
export class SysUserController {
  constructor(
    private readonly userCrudService: SysUserCrudService,
  ) { }

  @WalnutAdminDecoratorHasPermission(
    Permissions.CREATE,
  )
  @WalnutAdminDecoratorCreate()
  @WalnutTx()
  async create(
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() payload: SysUserDTOCreateRequest,
  ) {
    return plainToInstance(SysUserDTOCreateResponse, await this.userCrudService.create(payload, ctx.em))
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
  @WalnutTx()
  async update(
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() payload: SysUserDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(SysUserDTOUpdateResponse, await this.userCrudService.update(id, payload, ctx.em))
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

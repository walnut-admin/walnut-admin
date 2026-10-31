import { Body, Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'

import { WalnutCrudDecorators } from '@walnut-server/crud'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import {
  SysRoleDTOCreateRequest,
  SysRoleDTOCreateResponse,
  SysRoleDTOListRequest,
  SysRoleDTOListResponse,
  SysRoleDTOReadResponse,
  SysRoleDTOSafe,
  SysRoleDTOUpdateRequest,
  SysRoleDTOUpdateResponse,
  SysRoleService,
} from '@walnut-server/system'

import { plainToInstance } from 'class-transformer'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'

const Permissions = {
  CREATE: 'system:role:create',
  READ: 'system:role:read',
  UPDATE: 'system:role:update',
  LIST: 'system:role:list',
} as const

const { WalnutAdminDecoratorCreate, WalnutAdminDecoratorRead, WalnutAdminDecoratorUpdate, WalnutAdminDecoratorList }
  = WalnutCrudDecorators({
    title: WalnutAdminConstDecoratorLogOperateTitle.ROLE,
    DTO: SysRoleDTOSafe,
  })

/**
 * B5 迁移模板（controller 层，B1 同款）：路由参数 ParamMongoId → uuid 参数装饰器；
 * `.toObject()` 移除，统一 plainToInstance(DTO, entity)。create/update 加
 * @WalnutTx —— menus 拆 junction 后角色行与关联行必须同事务（Mongo 版
 * 单文档原子，PG 版靠 em 贯通）。
 */
@Controller('system/role')
@ApiTags('system/role')
export class SysRoleController {
  constructor(private readonly roleService: SysRoleService) {}

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  @WalnutTx()
  async create(
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() payload: SysRoleDTOCreateRequest,
  ) {
    return plainToInstance(SysRoleDTOCreateResponse, await this.roleService.create(payload, ctx.em))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysRoleDTOReadResponse, await this.roleService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  @WalnutTx()
  async update(
    @WalnutTxSession() ctx: WalnutTxContext,
    @Body() payload: SysRoleDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(SysRoleDTOUpdateResponse, await this.roleService.update(id, payload, ctx.em))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysRoleDTOListRequest) {
    return plainToInstance(SysRoleDTOListResponse, await this.roleService.list(payload))
  }
}

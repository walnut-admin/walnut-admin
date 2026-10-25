import { Body, Controller, Get, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutDBSession, WalnutDBTransaction, WalnutTxContext } from '@walnut-server/db'

import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { WalnutAdminDecoratorQueryDeleteCascade } from '@walnut-server/decorators/query'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { plainToInstance } from 'class-transformer'

import { WalnutCrudDecorators } from '@/decorators/crud'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import {
  assembleSysMenu,
  SysMenuDTOCreateRequest,
  SysMenuDTOCreateResponse,
  SysMenuDTODeleteResponse,
  SysMenuDTOListRequest,
  SysMenuDTOListResponse,
  SysMenuDTOReadResponse,
  SysMenuDTOSafe,
  SysMenuDTOTree,
  SysMenuDTOTreeResponse,
  SysMenuDTOUpdateRequest,
  SysMenuDTOUpdateResponse,
} from './dto/menu.dto'
import { SysMenuService } from './menu.service'

const Permissions = {
  CREATE: 'system:menu:create',
  READ: 'system:menu:read',
  UPDATE: 'system:menu:update',
  DELETE: 'system:menu:delete',
  LIST: 'system:menu:list',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.MENU,
  DTO: SysMenuDTOSafe,
})

/**
 * B5 迁移模板（controller 层，B1 同款）：路由参数 ParamMongoId → uuid 参数装饰器；
 * 事务句柄 `ctx.dbSession` → `ctx.em`；`.toObject()` 移除，改在原位置调
 * `assembleSysMenu`（19 拍平列 → meta 对象出参组装，DTO 层 helper）后
 * plainToInstance(DTO, entity)。
 */
@Controller('system/menu')
@ApiTags('system/menu')
export class SysMenuController {
  constructor(private readonly menuService: SysMenuService) { }

  // need to put this in front
  @Get('tree')
  @HttpCode(HttpStatus.OK)
  @ApiWalnutOkResponse({
    description: 'return full menu tree and tree without type element',
    DTO: SysMenuDTOTree,
  })
  async getTree() {
    const res = await this.menuService.getMenuTreeAndTreeWithoutTypeElement()
    // 节点行是组装后的 POJO（拍平列 + meta），经 @Type 元数据转成 SysMenuDTOTree 链
    return plainToInstance(SysMenuDTOTreeResponse, res)
  }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysMenuDTOCreateRequest) {
    return plainToInstance(SysMenuDTOCreateResponse, assembleSysMenu(await this.menuService.create(payload)))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysMenuDTOReadResponse, assembleSysMenu(await this.menuService.read(id)))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @Body() payload: SysMenuDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(SysMenuDTOUpdateResponse, assembleSysMenu(await this.menuService.update(id, payload)))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete()
  @WalnutDBTransaction()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
    @WalnutAdminDecoratorQueryDeleteCascade() cascade: number,
  ) {
    return plainToInstance(
      SysMenuDTODeleteResponse,
      assembleSysMenu(await this.menuService.delete(id, user.userId, cascade, ctx.em)),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysMenuDTOListRequest) {
    const res = await this.menuService.list(payload)

    return plainToInstance(SysMenuDTOListResponse, {
      data: res.data.map(entity => assembleSysMenu(entity)),
      total: res.total,
    })
  }
}

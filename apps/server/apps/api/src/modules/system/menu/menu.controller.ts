import { Body, Controller, Get, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'

import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { WalnutAdminDecoratorQueryDeleteCascade } from '@walnut-server/decorators/query'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { plainToInstance } from 'class-transformer'

import { WalnutCrudDecorators } from '@/decorators/crud'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminDecoratorVisitorDeny } from '@/guard/visitor.guard'
import {
  assembleSysMenu,
  SysMenuDTOCreateRequest,
  SysMenuDTOCreateResponse,
  SysMenuDTODeleteResponse,
  SysMenuDTOListRequest,
  SysMenuDTOListResponse,
  SysMenuDTOReadResponse,
  SysMenuDTOSafe,
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
    // 响应真身是 SysMenuDTOTreeResponse（fullTree / treeWithoutTypeElement /
    // menuActiveNamesOptions），此前文档只挂了单节点 SysMenuDTOTree —— OpenAPI
    // codegen 一期修正（响应 DTO 三字段补齐 ApiProperty 后可完整反射）
    DTO: SysMenuDTOTreeResponse,
  })
  // P2-20（2026-10-29）：菜单树含全量菜单行与 permission 权限串 —— visitor 显式拒绝。
  // 不挂 system:menu:* 的原因：tree 是菜单管理/角色授权视图的数据源（useMenuTree），
  // 普通非 root 用户可能被授予菜单管理权；permission guard 的 visitor 白名单又恰好
  // 放行 :list/:read，挡不住 visitor。导航数据走 /auth/permissions，不受本守卫影响。
  @WalnutAdminDecoratorVisitorDeny()
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
  @WalnutTx()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
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

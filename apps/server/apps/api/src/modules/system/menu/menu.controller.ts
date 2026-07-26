import { Body, Controller, Get, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut/const/decorator/logOperate'

import { WalnutDBSession, WalnutDBTransaction } from '@walnut/db'
import { WalnutAdminDecoratorParamMongoId } from '@walnut/decorators/params'
import { WalnutAdminDecoratorQueryDeleteCascade } from '@walnut/decorators/query'

import { ApiWalnutOkResponse } from '@walnut/decorators/swagger/response.decorator'
import { ClientSession } from 'mongoose'
import { WalnutCrudDecorators } from '@/decorators/crud'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import {
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
    return new SysMenuDTOTreeResponse(res)
  }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysMenuDTOCreateRequest) {
    return new SysMenuDTOCreateResponse(
      (await this.menuService.create(payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SysMenuDTOReadResponse(
      (await this.menuService.read(id)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @WalnutAdminDecoratorParamMongoId() id: string,
    @Body() payload: SysMenuDTOUpdateRequest,
  ) {
    return new SysMenuDTOUpdateResponse(
      (await this.menuService.update(id, payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete()
  @WalnutDBTransaction()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() session: ClientSession,
    @WalnutAdminDecoratorParamMongoId() id: string,
    @WalnutAdminDecoratorQueryDeleteCascade() cascade: number,
  ) {
    return new SysMenuDTODeleteResponse(
      (await this.menuService.delete(id, user.userId, cascade, session)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysMenuDTOListRequest) {
    return new SysMenuDTOListResponse(await this.menuService.list(payload))
  }
}
